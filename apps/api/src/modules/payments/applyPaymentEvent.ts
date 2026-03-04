import { nanoid } from "nanoid";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { emitDomainEvent } from "../../lib/domainEvents.js";
import { DomainEventName } from "../../domain/events.js";
import { generateTicketCode } from "../../lib/qr.js";

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
      const now = new Date();
      const reservationExpired = !!order.reservedUntil && order.reservedUntil < now;

      if (reservationExpired) {
        let hasStock = true;
        for (const item of order.items) {
          await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = CAST(${item.ticketTypeId} AS uuid) FOR UPDATE`;
          const tt = await tx.ticketType.findUniqueOrThrow({ where: { id: item.ticketTypeId } });
          const paid = await tx.orderItem.aggregate({
            _sum: { quantity: true },
            where: { ticketTypeId: tt.id, order: { status: "paid" } }
          });
          const activeReservations = await tx.inventoryReservation.aggregate({
            _sum: { quantity: true },
            where: { ticketTypeId: tt.id, releasedAt: null, expiresAt: { gt: now } }
          });
          const used = (paid._sum.quantity ?? 0) + (activeReservations._sum.quantity ?? 0);
          if (used + item.quantity > tt.quota) {
            hasStock = false;
            break;
          }
        }

        if (!hasStock) {
          await tx.order.update({ where: { id: order.id }, data: { status: "paid_no_stock" } });
          await emitDomainEvent({
            type: DomainEventName.PAYMENT_MARKED_NO_STOCK,
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
          return { ok: true, outcome: "paid_no_stock" };
        }
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
