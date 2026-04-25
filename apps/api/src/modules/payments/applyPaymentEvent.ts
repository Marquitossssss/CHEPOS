import { nanoid } from "nanoid";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { emitDomainEvent } from "../../lib/domainEvents.js";
import { DomainEventName } from "../../domain/events.js";
import { generateTicketCode } from "../../lib/qr.js";
import { materializePayment } from "./materializePayment.js";
import { latePaymentCasesTotal } from "../../observability/metrics.js";

type ApplyResult = { ok: true; outcome: string };

function mapEventTypeToTarget(eventType: string): "paid" | "failed" | "refunded" | null {
  const normalized = eventType.toLowerCase();
  if (normalized.includes("succeeded") || normalized.includes("paid")) return "paid";
  if (normalized.includes("failed")) return "failed";
  if (normalized.includes("refunded")) return "refunded";
  return null;
}

const terminalStatuses = new Set(["paid", "failed", "refunded", "paid_no_stock"]);

async function markEventProcessed(
  tx: Prisma.TransactionClient,
  paymentEventId: string,
  updates: { ignoredReason?: string | null; processError?: string | null }
) {
  await tx.paymentEvent.update({
    where: { id: paymentEventId },
    data: {
      ignoredReason: updates.ignoredReason ?? null,
      processError: updates.processError ?? null,
      processedAt: new Date()
    }
  });
}

async function ensureLatePaymentCase(
  tx: Prisma.TransactionClient,
  params: {
    order: { id: string; organizerId: string; eventId: string };
    paymentEvent: { id: string; provider: string; providerPaymentId: string | null };
    paymentId: string;
    reserveId?: string | null;
    inventoryReleased: boolean;
    correlationId: string;
  }
) {
  if (!params.paymentEvent.providerPaymentId) return null;

  const existing = await tx.latePaymentCase.findUnique({
    where: {
      provider_providerPaymentId: {
        provider: params.paymentEvent.provider,
        providerPaymentId: params.paymentEvent.providerPaymentId
      }
    }
  });

  if (existing) {
    latePaymentCasesTotal.inc({ provider: params.paymentEvent.provider, reason: "duplicate_noop" });
    return existing;
  }

  const created = await tx.latePaymentCase.create({
    data: {
      orderId: params.order.id,
      reserveId: params.reserveId ?? null,
      provider: params.paymentEvent.provider,
      providerPaymentId: params.paymentEvent.providerPaymentId,
      paymentAttemptId: params.paymentId,
      inventoryReleased: params.inventoryReleased,
      status: "PENDING"
    }
  });

  latePaymentCasesTotal.inc({ provider: params.paymentEvent.provider, reason: "created" });

  await emitDomainEvent({
    type: DomainEventName.LATE_PAYMENT_CASE_CREATED,
    correlationId: params.correlationId,
    actorType: "webhook",
    aggregateType: "order",
    aggregateId: params.order.id,
    organizerId: params.order.organizerId,
    eventId: params.order.eventId,
    orderId: params.order.id,
    context: {
      source: "webhooks.payments",
      provider: params.paymentEvent.provider
    },
    payload: {
      latePaymentCaseId: created.id,
      paymentEventId: params.paymentEvent.id,
      paymentAttemptId: params.paymentId,
      providerPaymentId: params.paymentEvent.providerPaymentId,
      inventoryReleased: params.inventoryReleased
    }
  }, tx);

  return created;
}

export async function applyPaymentEvent(paymentEventId: string, correlationId: string): Promise<ApplyResult> {
  return prisma.$transaction(async (tx) => {
    const paymentEvent = await tx.paymentEvent.findUnique({ where: { id: paymentEventId } });
    if (!paymentEvent) return { ok: true, outcome: "missing_event" };

    if (paymentEvent.processedAt) return { ok: true, outcome: "already_processed" };

    if (!paymentEvent.orderId) {
      await markEventProcessed(tx, paymentEvent.id, { ignoredReason: "unmatched" });
      return { ok: true, outcome: "unmatched" };
    }

    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = CAST(${paymentEvent.orderId} AS uuid) FOR UPDATE`;

    const order = await tx.order.findUnique({
      where: { id: paymentEvent.orderId },
      include: {
        items: true,
        reservations: {
          where: { releasedAt: null },
          orderBy: { createdAt: "desc" }
        },
        tickets: { select: { id: true }, take: 1 }
      }
    });

    if (!order) {
      await markEventProcessed(tx, paymentEvent.id, { ignoredReason: "unmatched" });
      return { ok: true, outcome: "unmatched" };
    }

    if (terminalStatuses.has(order.status)) {
      await markEventProcessed(tx, paymentEvent.id, { ignoredReason: "terminal_guard" });
      return { ok: true, outcome: "terminal_guard" };
    }

    const target = mapEventTypeToTarget(paymentEvent.eventType);
    if (!target) {
      await markEventProcessed(tx, paymentEvent.id, { ignoredReason: "unsupported_event_type" });
      return { ok: true, outcome: "unsupported_event_type" };
    }

    if (target === "paid") {
      if (!paymentEvent.providerPaymentId) {
        const identityError: Error & { statusCode?: number; code?: string } = new Error("providerPaymentId required for paid webhook");
        identityError.statusCode = 422;
        identityError.code = "MISSING_PAYMENT_IDENTITY";
        throw identityError;
      }

      const paymentResult = await materializePayment(tx, {
        orderId: order.id,
        provider: paymentEvent.provider,
        providerRef: paymentEvent.providerPaymentId,
        amountCents: order.totalCents,
        status: "paid"
      });

      if (paymentResult.state === "existing" && terminalStatuses.has(order.status)) {
        await markEventProcessed(tx, paymentEvent.id, { ignoredReason: "terminal_guard" });
        return { ok: true, outcome: "terminal_guard" };
      }

      const reservationExpired = !!order.reservedUntil && order.reservedUntil < new Date();
      const activeReservations = order.reservations.filter((reservation) => reservation.releasedAt === null);
      const hasActiveReservations = activeReservations.length > 0;

      if (reservationExpired) {
        const restoreByTicketType = new Map<string, number>();
        for (const reservation of activeReservations) {
          restoreByTicketType.set(
            reservation.ticketTypeId,
            (restoreByTicketType.get(reservation.ticketTypeId) ?? 0) + reservation.quantity
          );
        }

        const ticketTypeIds = [...restoreByTicketType.keys()].sort();
        for (const ticketTypeId of ticketTypeIds) {
          await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = CAST(${ticketTypeId} AS uuid) FOR UPDATE`;
        }

        for (const [ticketTypeId, quantity] of restoreByTicketType.entries()) {
          await tx.ticketType.update({
            where: { id: ticketTypeId },
            data: { remaining: { increment: quantity } }
          });
        }

        if (activeReservations.length > 0) {
          await tx.inventoryReservation.updateMany({
            where: { id: { in: activeReservations.map((reservation) => reservation.id) }, releasedAt: null },
            data: { releasedAt: new Date(), releaseReason: "expired_payment_compensation" }
          });
        }

        await tx.order.update({ where: { id: order.id }, data: { status: "paid_no_stock" } });
        await ensureLatePaymentCase(tx, {
          order,
          paymentEvent,
          paymentId: paymentResult.paymentId,
          reserveId: activeReservations[0]?.id ?? null,
          inventoryReleased: activeReservations.length > 0,
          correlationId
        });
        await emitDomainEvent({
          type: DomainEventName.PAYMENT_MARKED_NO_STOCK,
          correlationId,
          actorType: "webhook",
          aggregateType: "order",
          aggregateId: order.id,
          organizerId: order.organizerId,
          eventId: order.eventId,
          orderId: order.id,
          context: {
            source: "webhooks.payments",
            provider: paymentEvent.provider,
            reservationReleased: hasActiveReservations
          },
          payload: {
            paymentEventId: paymentEvent.id,
            releasedReservationCount: activeReservations.length
          }
        }, tx);
        await markEventProcessed(tx, paymentEvent.id, { ignoredReason: null });
        return { ok: true, outcome: "paid_no_stock" };
      }

      const updateResult = await tx.order.updateMany({
        where: { id: order.id, status: { in: ["pending", "reserved", "expired"] } },
        data: { status: "paid" }
      });

      if (updateResult.count === 0) {
        await markEventProcessed(tx, paymentEvent.id, { ignoredReason: "terminal_guard" });
        return { ok: true, outcome: "terminal_guard" };
      }

      if (order.tickets.length === 0) {
        const rows = order.items.flatMap((item) =>
          Array.from({ length: item.quantity }).map(() => {
            const finalCode = generateTicketCode(nanoid(18));
            return {
              orderId: order.id,
              ticketTypeId: item.ticketTypeId,
              eventId: order.eventId,
              code: finalCode,
              qrPayload: finalCode
            };
          })
        );

        if (rows.length > 0) {
          await tx.ticket.createMany({ data: rows });
          await emitDomainEvent({
            type: DomainEventName.TICKETS_ISSUED,
            correlationId,
            actorType: "webhook",
            aggregateType: "order",
            aggregateId: order.id,
            organizerId: order.organizerId,
            eventId: order.eventId,
            orderId: order.id,
            context: { source: "webhooks.payments" },
            payload: { issuedCount: rows.length }
          }, tx);
        }
      }

      await emitDomainEvent({
        type: DomainEventName.ORDER_PAID,
        correlationId,
        actorType: "webhook",
        aggregateType: "order",
        aggregateId: order.id,
        organizerId: order.organizerId,
        eventId: order.eventId,
        orderId: order.id,
        context: { source: "webhooks.payments", provider: paymentEvent.provider },
        payload: {
          paymentEventId: paymentEvent.id,
          providerPaymentId: paymentEvent.providerPaymentId
        }
      }, tx);

      await tx.inventoryReservation.updateMany({
        where: { orderId: order.id, releasedAt: null },
        data: { releasedAt: new Date() }
      });

      await markEventProcessed(tx, paymentEvent.id, { ignoredReason: null });
      return { ok: true, outcome: "paid" };
    }

    if (target === "failed") {
      await tx.order.updateMany({
        where: { id: order.id, status: { in: ["pending", "reserved"] } },
        data: { status: "failed" }
      });
      await emitDomainEvent({
        type: DomainEventName.PAYMENT_MARKED_FAILED,
        correlationId,
        actorType: "webhook",
        aggregateType: "order",
        aggregateId: order.id,
        organizerId: order.organizerId,
        eventId: order.eventId,
        orderId: order.id,
        context: { source: "webhooks.payments", provider: paymentEvent.provider },
        payload: { paymentEventId: paymentEvent.id }
      }, tx);
      await markEventProcessed(tx, paymentEvent.id, { ignoredReason: null });
      return { ok: true, outcome: "failed" };
    }

    await tx.order.updateMany({
      where: { id: order.id, status: { in: ["paid", "failed", "pending", "reserved", "expired"] } },
      data: { status: "refunded" }
    });
    await emitDomainEvent({
      type: DomainEventName.PAYMENT_MARKED_REFUNDED,
      correlationId,
      actorType: "webhook",
      aggregateType: "order",
      aggregateId: order.id,
      organizerId: order.organizerId,
      eventId: order.eventId,
      orderId: order.id,
      context: { source: "webhooks.payments", provider: paymentEvent.provider },
      payload: { paymentEventId: paymentEvent.id }
    }, tx);
    await markEventProcessed(tx, paymentEvent.id, { ignoredReason: null });
    return { ok: true, outcome: "refunded" };
  });
}
