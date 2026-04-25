import type { Prisma } from "@prisma/client";
import { emitDomainEvent } from "../lib/domainEvents.js";
import { prisma } from "../lib/prisma.js";
import { DomainEventName } from "../domain/events.js";
import { ttlReleasedTotal, ttlRestoredUnitsTotal, ttlSkippedAlreadyReleasedTotal, ttlSkippedTotal } from "../observability/metrics.js";

const TTL_RELEASE_LOCK_NAMESPACE = 42_001;
const TTL_RELEASE_LOCK_KEY = 15_001;

type ReleaseExpiredSummary = {
  status: "processed" | "skipped";
  skipReason: "lock_not_acquired" | null;
  expiredOrders: number;
  releasedReservations: number;
  // Best-effort per-run telemetry under concurrent job overlap.
  // Strong correctness contract is the durable final state in DB, not exact per-run attribution.
  restoredUnits: number;
  skippedAlreadyReleased: number;
};

type ReleaseExpiredReservationsOptions = {
  afterLockAcquired?: () => Promise<void>;
};

async function tryAcquireReleaseExpiredReservationsLock(tx: Prisma.TransactionClient): Promise<boolean> {
  const [row] = await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_xact_lock(CAST(${TTL_RELEASE_LOCK_NAMESPACE} AS integer), CAST(${TTL_RELEASE_LOCK_KEY} AS integer)) AS "locked"
  `;

  return row?.locked === true;
}

function lockSkippedSummary(): ReleaseExpiredSummary {
  return {
    status: "skipped",
    skipReason: "lock_not_acquired",
    expiredOrders: 0,
    releasedReservations: 0,
    restoredUnits: 0,
    skippedAlreadyReleased: 0
  };
}

export async function releaseExpiredReservationsTx(
  tx: Prisma.TransactionClient,
  now: Date,
  correlationId = `job:releaseExpiredReservations:${now.toISOString()}`
): Promise<ReleaseExpiredSummary> {
  const expiredOrders = await tx.order.findMany({
    where: { status: "reserved", reservedUntil: { lt: now } },
    select: { id: true, organizerId: true, eventId: true },
    orderBy: { id: "asc" }
  });

  if (expiredOrders.length === 0) {
    return {
      expiredOrders: 0,
      status: "processed",
      skipReason: null,
      releasedReservations: 0,
      restoredUnits: 0,
      skippedAlreadyReleased: 0
    };
  }

  const expiredOrderIds: string[] = [];
  const expiredOrdersForEvents: typeof expiredOrders = [];
  let releasedReservations = 0;
  let restoredUnits = 0;
  let skippedAlreadyReleased = 0;

  for (const order of expiredOrders) {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = CAST(${order.id} AS uuid) FOR UPDATE`;

    const currentOrder = await tx.order.findUnique({
      where: { id: order.id },
      select: { id: true, status: true, reservedUntil: true }
    });

    if (!currentOrder || currentOrder.status !== "reserved" || !currentOrder.reservedUntil || currentOrder.reservedUntil >= now) {
      continue;
    }

    const expireOrder = await tx.order.updateMany({
      where: { id: order.id, status: "reserved", reservedUntil: { lt: now } },
      data: { status: "expired" }
    });

    if (expireOrder.count === 0) {
      continue;
    }

    const activeReservations = await tx.inventoryReservation.findMany({
      where: {
        orderId: order.id,
        expiresAt: { lt: now },
        releasedAt: null
      },
      select: {
        id: true,
        ticketTypeId: true,
        quantity: true
      },
      orderBy: { id: "asc" }
    });

    const alreadyReleasedCount = await tx.inventoryReservation.count({
      where: {
        orderId: order.id,
        expiresAt: { lt: now },
        releasedAt: { not: null }
      }
    });
    skippedAlreadyReleased += alreadyReleasedCount;

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

    for (const reservation of activeReservations) {
      const released = await tx.inventoryReservation.updateMany({
        where: { id: reservation.id, releasedAt: null },
        data: { releasedAt: now, releaseReason: "expired_ttl" }
      });

      if (released.count === 0) continue;

      await tx.ticketType.update({
        where: { id: reservation.ticketTypeId },
        data: { remaining: { increment: reservation.quantity } }
      });
      releasedReservations += 1;
      restoredUnits += reservation.quantity;
    }

    expiredOrderIds.push(order.id);
    expiredOrdersForEvents.push(order);
  }

  for (const order of expiredOrdersForEvents) {
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
    status: "processed",
    skipReason: null,
    expiredOrders: expiredOrderIds.length,
    releasedReservations,
    restoredUnits,
    skippedAlreadyReleased
  };
}

export async function releaseExpiredReservations(now = new Date(), options: ReleaseExpiredReservationsOptions = {}): Promise<ReleaseExpiredSummary> {
  const summary = await prisma.$transaction(async (tx) => {
    const lockAcquired = await tryAcquireReleaseExpiredReservationsLock(tx);
    if (!lockAcquired) return lockSkippedSummary();

    await options.afterLockAcquired?.();

    return releaseExpiredReservationsTx(tx, now);
  });

  if (summary.skipReason === "lock_not_acquired") {
    ttlSkippedTotal.inc({ reason: "lock_not_acquired" });
    console.info({ job: "releaseExpiredReservations", reason: summary.skipReason }, "TTL release job skipped");
  }

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
