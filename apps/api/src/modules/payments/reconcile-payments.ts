import { prisma } from "../../lib/prisma.js";
import { applyOrderPaidTransition } from "./applyPaidTransition.js";
import { fetchMercadoPagoPayment } from "./mercadopago-provider.js";
import { emitDomainEvent } from "../../lib/domainEvents.js";
import { DomainEventName } from "../../domain/events.js";

function isPaidStatus(status: string) {
  return ["paid", "approved", "captured", "succeeded"].includes(status.toLowerCase());
}

export async function runPaymentsReconciliationCycle() {
  const now = Date.now();
  const min = new Date(now - 10 * 60 * 1000);
  const max = new Date(now - 24 * 60 * 60 * 1000);

  const pending = await prisma.paymentAttempt.findMany({
    where: {
      provider: "mercadopago",
      lastSeenAt: { lte: min, gte: max },
      reconciledAt: null,
      orderId: { not: null }
    },
    take: 200
  });

  for (const attempt of pending) {
    const remote = await fetchMercadoPagoPayment(attempt.providerPaymentId);
    const status = remote?.status ?? attempt.status;
    const orderId = attempt.orderId ?? (typeof remote?.external_reference === "string" ? remote.external_reference : null);
    if (!orderId) continue;

    if (isPaidStatus(status)) {
      const transition = await applyOrderPaidTransition({
        orderId,
        provider: attempt.provider,
        providerRef: attempt.providerPaymentId,
        idempotencyKey: `reconcile:${attempt.provider}:${attempt.providerPaymentId}`,
        correlationId: `reconcile-${attempt.id}`,
        source: "reconcile-payments",
        actorType: "worker"
      });

      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status, lastSeenAt: new Date(), reconciledAt: new Date() } });
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { organizerId: true, eventId: true } });
      if (order) {
        await emitDomainEvent({
          type: DomainEventName.PAYMENT_RECONCILED_PAID,
          correlationId: `reconcile-${attempt.id}`,
          actorType: "worker",
          aggregateType: "order",
          aggregateId: orderId,
          organizerId: order.organizerId,
          eventId: order.eventId,
          orderId,
          context: { source: "reconcile-payments", provider: attempt.provider },
          payload: { providerPaymentId: attempt.providerPaymentId, transition: transition.reason }
        }, prisma);
      }
    } else {
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status, lastSeenAt: new Date(), reconciledAt: new Date() } });
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { organizerId: true, eventId: true } });
      if (order) {
        await emitDomainEvent({
          type: DomainEventName.PAYMENT_RECONCILED_FAILED,
          correlationId: `reconcile-${attempt.id}`,
          actorType: "worker",
          aggregateType: "order",
          aggregateId: orderId,
          organizerId: order.organizerId,
          eventId: order.eventId,
          orderId,
          context: { source: "reconcile-payments", provider: attempt.provider },
          payload: { providerPaymentId: attempt.providerPaymentId, status }
        }, prisma);
      }
    }
  }

  return pending.length;
}
