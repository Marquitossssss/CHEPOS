import type { Prisma } from "@prisma/client";
import { emitDomainEvent } from "../lib/domainEvents.js";
import { prisma } from "../lib/prisma.js";
import { DomainEventName } from "../domain/events.js";
import { ttlReleasedTotal, ttlRestoredUnitsTotal, ttlSkippedAlreadyReleasedTotal } from "../observability/metrics.js";

type ReleaseExpiredSummary = {
  expiredOrders: number;
  releasedReservations: number;
  restoredUnits: number;
  skippedAlreadyReleased: number;
};

export async function releaseExpiredReservationsTx(
  tx: Prisma.TransactionClient,
  now: Date,
  correlationId = `job:releaseExpiredReservations:${now.toISOString()}`
): Promise<ReleaseExpiredSummary> {
  const expiredOrders = await tx.order.findMany({
    where: { status: "reserved", reservedUntil: { lt: now } },
    select: { id: true, organizerId: true, eventId: true }
  });

  if (expiredOrders.length === 0) {
    return {
      expiredOrders: 0,
      releasedReservations: 0,
      restoredUnits: 0,
      skippedAlreadyReleased: 0
    };
  }

  const orderIds = expiredOrders.map((order) => order.id);

  const activeReservations = await tx.inventoryReservation.findMany({
    where: {
      orderId: { in: orderIds },
      expiresAt: { lt: now },
      releasedAt: null
    },
    select: {
      id: true,
      orderId: true,
      ticketTypeId: true,
      quantity: true
    }
  });

  const alreadyReleasedCount = await tx.inventoryReservation.count({
    where: {
      orderId: { in: orderIds },
      expiresAt: { lt: now },
      releasedAt: { not: null }
    }
  });

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

  const releasedReservationIds = activeReservations.map((reservation) => reservation.id);
  if (releasedReservationIds.length > 0) {
    await tx.inventoryReservation.updateMany({
      where: { id: { in: releasedReservationIds }, releasedAt: null },
      data: { releasedAt: now, releaseReason: "expired_ttl" }
    });
  }

  await tx.order.updateMany({
    where: { id: { in: orderIds }, status: "reserved", reservedUntil: { lt: now } },
    data: { status: "expired" }
  });

  for (const order of expiredOrders) {
    await emitDomainEvent({
      type: DomainEventName.ORDER_EXPIRED,
      correlationId,
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

  return {
    expiredOrders: expiredOrders.length,
    releasedReservations: activeReservations.length,
    restoredUnits: [...restoreByTicketType.values()].reduce((sum, value) => sum + value, 0),
    skippedAlreadyReleased: alreadyReleasedCount
  };
}

export async function releaseExpiredReservations(now = new Date()): Promise<ReleaseExpiredSummary> {
  const summary = await prisma.$transaction((tx) =>
    releaseExpiredReservationsTx(tx, now)
  );

  if (summary.expiredOrders > 0) {
    ttlReleasedTotal.inc(summary.expiredOrders);
  }
  if (summary.restoredUnits > 0) {
    ttlRestoredUnitsTotal.inc(summary.restoredUnits);
  }
  if (summary.skippedAlreadyReleased > 0) {
    ttlSkippedAlreadyReleasedTotal.inc(summary.skippedAlreadyReleased);
  }

  return summary;
}

async function run() {
  await releaseExpiredReservations(new Date());
}

const invokedAsScript = process.argv[1] ? process.argv[1].endsWith("releaseExpiredReservations.ts") || process.argv[1].endsWith("releaseExpiredReservations.js") : false;

if (invokedAsScript) {
  run().finally(async () => prisma.$disconnect());
}
