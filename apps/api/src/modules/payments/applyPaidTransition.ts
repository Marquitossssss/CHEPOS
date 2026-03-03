import { nanoid } from "nanoid";
import { prisma } from "../../lib/prisma.js";
import { generateTicketCode } from "../../lib/qr.js";
import { emitDomainEvent } from "../../lib/domainEvents.js";
import { DomainEventName } from "../../domain/events.js";

export type PaidTransitionResult = { result: "applied" | "noop"; reason: string; orderId: string };

export async function applyOrderPaidTransition(params: {
  orderId: string;
  provider: string;
  providerRef: string;
  idempotencyKey: string;
  correlationId: string;
  source: "webhooks.payments" | "webhooks.mercadopago" | "reconcile-payments";
  actorType?: "webhook" | "worker";
}): Promise<PaidTransitionResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = CAST(${params.orderId} AS uuid) FOR UPDATE`;

    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      include: { items: true, tickets: { select: { id: true }, take: 1 } }
    });

    if (!order) {
      return { result: "noop", reason: "order_not_found", orderId: params.orderId };
    }

    await tx.paymentIdempotencyKey.upsert({
      where: { provider_idempotencyKey: { provider: params.provider, idempotencyKey: params.idempotencyKey } },
      update: { orderId: order.id },
      create: {
        provider: params.provider,
        idempotencyKey: params.idempotencyKey,
        orderId: order.id,
        status: "in_progress"
      }
    });

    if (order.status === "paid") {
      await tx.paymentIdempotencyKey.update({
        where: { provider_idempotencyKey: { provider: params.provider, idempotencyKey: params.idempotencyKey } },
        data: { status: "completed", completedAt: new Date() }
      });
      return { result: "noop", reason: "already_paid", orderId: order.id };
    }

    if (["canceled", "expired", "refunded"].includes(order.status)) {
      await tx.paymentIdempotencyKey.update({
        where: { provider_idempotencyKey: { provider: params.provider, idempotencyKey: params.idempotencyKey } },
        data: { status: "completed", completedAt: new Date() }
      });
      return { result: "noop", reason: `state_${order.status}`, orderId: order.id };
    }

    await tx.payment.upsert({
      where: { provider_providerRef: { provider: params.provider, providerRef: params.providerRef } },
      update: { status: "paid" },
      create: {
        orderId: order.id,
        provider: params.provider,
        providerRef: params.providerRef,
        status: "paid",
        amountCents: order.totalCents
      }
    });

    const barrierMs = Number(process.env.PAYMENTS_CONCURRENCY_TEST_BARRIER_MS ?? 0);
    if (barrierMs > 0 && process.env.NODE_ENV === "test") {
      await new Promise((resolve) => setTimeout(resolve, barrierMs));
    }

    const updated = await tx.order.updateMany({
      where: { id: order.id, status: { in: ["pending", "reserved"] } },
      data: { status: "paid" }
    });

    if (updated.count === 0) {
      await tx.paymentIdempotencyKey.update({
        where: { provider_idempotencyKey: { provider: params.provider, idempotencyKey: params.idempotencyKey } },
        data: { status: "completed", completedAt: new Date() }
      });
      return { result: "noop", reason: "transition_guard_noop", orderId: order.id };
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
          correlationId: params.correlationId,
          actorType: params.actorType ?? "webhook",
          aggregateType: "order",
          aggregateId: order.id,
          organizerId: order.organizerId,
          eventId: order.eventId,
          orderId: order.id,
          context: { source: params.source },
          payload: { issuedCount: rows.length }
        }, tx);
      }
    }

    await tx.inventoryReservation.updateMany({ where: { orderId: order.id, releasedAt: null }, data: { releasedAt: new Date() } });

    await emitDomainEvent({
      type: DomainEventName.ORDER_PAID,
      correlationId: params.correlationId,
      actorType: params.actorType ?? "webhook",
      aggregateType: "order",
      aggregateId: order.id,
      organizerId: order.organizerId,
      eventId: order.eventId,
      orderId: order.id,
      context: { source: params.source, provider: params.provider },
      payload: { providerRef: params.providerRef, amountCents: order.totalCents }
    }, tx);

    await tx.paymentIdempotencyKey.update({
      where: { provider_idempotencyKey: { provider: params.provider, idempotencyKey: params.idempotencyKey } },
      data: { status: "completed", completedAt: new Date() }
    });

    return { result: "applied", reason: "paid_transition_applied", orderId: order.id };
  });
}
