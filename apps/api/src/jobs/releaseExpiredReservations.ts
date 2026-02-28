import { emitDomainEvent } from "../lib/domainEvents.js";
import { prisma } from "../lib/prisma.js";
import { DomainEventName } from "../domain/events.js";

async function run() {
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const expiredOrders = await tx.order.findMany({
      where: { status: "reserved", reservedUntil: { lt: now } },
      select: { id: true, organizerId: true, eventId: true }
    });

    await tx.inventoryReservation.updateMany({ where: { expiresAt: { lt: now }, releasedAt: null }, data: { releasedAt: now } });
    await tx.order.updateMany({ where: { status: "reserved", reservedUntil: { lt: now } }, data: { status: "expired" } });

    for (const order of expiredOrders) {
      await emitDomainEvent({
        type: DomainEventName.ORDER_EXPIRED,
        correlationId: `job:releaseExpiredReservations:${now.toISOString()}`,
        actorType: "system",
        aggregateType: "order",
        aggregateId: order.id,
        organizerId: order.organizerId,
        eventId: order.eventId,
        orderId: order.id,
        context: { source: "jobs.releaseExpiredReservations" },
        payload: { expiredAt: now.toISOString() }
      }, tx);
    }
  });
}

run().finally(async () => prisma.$disconnect());
