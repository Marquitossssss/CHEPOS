import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import type { DashboardQuery } from "./dashboard.schemas.js";

type JwtPayload = { userId: string; email: string };

type TicketTypeBreakdown = {
  ticketTypeId: string;
  name: string;
  priceCents: number;
  currency: string;
  quota: number;
  sold: number;
  checkedIn: number;
  reservedActive: number;
  available: number;
};

export interface EventDashboardDTO {
  event: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    startsAt: string;
    endsAt: string;
  };
  kpis: {
    ordersPaid: number;
    revenuePaidCents: number;
    ticketsSold: number;
    checkins: number;
    reservationsActive: number;
    latePaymentReviewRequired: number;
  };
  salesSeries: Array<{
    bucketStart: string;
    ordersPaid: number;
    revenuePaidCents: number;
  }>;
  byTicketType: TicketTypeBreakdown[];
  recentScans: Array<{
    id: string;
    ticketId: string;
    scannedAt: string;
    result: string;
    reason: string | null;
    gate: string | null;
    scannedByEmail: string | null;
  }>;
  alerts: {
    latePaymentReviewRequired: number;
    recentEmailFailures: number;
  };
  activity: Array<{
    id: string;
    type: string;
    occurredAt: string;
    actorType: string;
    actorId: string | null;
    aggregateType: string;
    aggregateId: string;
    correlationId: string | null;
    payload: unknown;
  }>;
}

type SeriesRow = {
  bucketStartLocal: Date;
  ordersPaid: bigint;
  revenuePaidCents: bigint;
};

export async function buildEventDashboard(user: JwtPayload, eventId: string, query: DashboardQuery): Promise<EventDashboardDTO> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      name: true,
      slug: true,
      timezone: true,
      startsAt: true,
      endsAt: true,
      organizerId: true
    }
  });

  if (!event) throw new Error("NOT_FOUND");

  const membership = await prisma.membership.findUnique({
    where: { userId_organizerId: { userId: user.userId, organizerId: event.organizerId } },
    select: { role: true }
  });

  if (!membership) throw new Error("FORBIDDEN");

  const now = new Date();

  const [ordersPaidAgg, ticketsSold, checkins, reservationsActive, latePaymentReviewRequired, ticketTypes, soldByType, checkedInByType, reservedByType, recentScans, recentEmailFailures, activity] = await Promise.all([
    prisma.order.aggregate({
      where: { eventId, status: "paid" },
      _count: { _all: true },
      _sum: { totalCents: true }
    }),
    prisma.ticket.count({
      where: {
        eventId,
        status: { in: ["issued", "checked_in"] },
        order: { status: "paid" }
      }
    }),
    prisma.ticket.count({
      where: {
        eventId,
        status: "checked_in",
        order: { status: "paid" }
      }
    }),
    prisma.inventoryReservation.aggregate({
      where: {
        order: { eventId },
        releasedAt: null,
        expiresAt: { gt: now }
      },
      _sum: { quantity: true }
    }),
    prisma.order.count({ where: { eventId, latePaymentReviewRequired: true } }),
    prisma.ticketType.findMany({ where: { eventId }, select: { id: true, name: true, priceCents: true, currency: true, quota: true } }),
    prisma.ticket.groupBy({
      by: ["ticketTypeId"],
      where: { eventId, status: { in: ["issued", "checked_in"] }, order: { status: "paid" } },
      _count: { _all: true }
    }),
    prisma.ticket.groupBy({
      by: ["ticketTypeId"],
      where: { eventId, status: "checked_in", order: { status: "paid" } },
      _count: { _all: true }
    }),
    prisma.inventoryReservation.groupBy({
      by: ["ticketTypeId"],
      where: {
        order: { eventId },
        releasedAt: null,
        expiresAt: { gt: now }
      },
      _sum: { quantity: true }
    }),
    prisma.ticketScan.findMany({
      where: { eventId },
      orderBy: { scannedAt: "desc" },
      take: 20,
      select: {
        id: true,
        ticketId: true,
        scannedAt: true,
        result: true,
        reason: true,
        gate: true,
        scannedBy: { select: { email: true } }
      }
    }),
    prisma.emailEvent.count({
      where: {
        order: { eventId },
        eventType: { in: ["bounce", "dropped", "deferred", "blocked", "spamreport", "unsubscribe"] }
      }
    }),
    prisma.domainEvent.findMany({
      where: { eventId },
      orderBy: { occurredAt: "desc" },
      take: 20,
      select: {
        id: true,
        type: true,
        occurredAt: true,
        actorType: true,
        actorId: true,
        aggregateType: true,
        aggregateId: true,
        correlationId: true,
        payload: true
      }
    })
  ]);

  const bucketExpr = query.bucket === "hour" ? Prisma.sql`'hour'` : Prisma.sql`'day'`;
  const range = query.range === "24h"
    ? Prisma.sql`NOW() - INTERVAL '24 hours'`
    : query.range === "30d"
      ? Prisma.sql`NOW() - INTERVAL '30 days'`
      : query.range === "90d"
        ? Prisma.sql`NOW() - INTERVAL '90 days'`
        : Prisma.sql`NOW() - INTERVAL '7 days'`;

  const salesSeries = await prisma.$queryRaw<SeriesRow[]>(Prisma.sql`
    SELECT
      date_trunc(${bucketExpr}, (o."createdAt" AT TIME ZONE ${event.timezone})) AS "bucketStartLocal",
      COUNT(*)::bigint AS "ordersPaid",
      COALESCE(SUM(o."totalCents"), 0)::bigint AS "revenuePaidCents"
    FROM "Order" o
    WHERE o."eventId" = CAST(${eventId} AS uuid)
      AND o."status" = 'paid'
      AND o."createdAt" >= ${range}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const soldMap = new Map(soldByType.map((row) => [row.ticketTypeId, row._count._all]));
  const checkinsMap = new Map(checkedInByType.map((row) => [row.ticketTypeId, row._count._all]));
  const reservedMap = new Map(reservedByType.map((row) => [row.ticketTypeId, row._sum.quantity ?? 0]));

  const byTicketType: TicketTypeBreakdown[] = ticketTypes.map((tt) => {
    const sold = soldMap.get(tt.id) ?? 0;
    const checkedIn = checkinsMap.get(tt.id) ?? 0;
    const reservedActive = reservedMap.get(tt.id) ?? 0;
    const available = tt.quota - sold - reservedActive;
    return {
      ticketTypeId: tt.id,
      name: tt.name,
      priceCents: tt.priceCents,
      currency: tt.currency,
      quota: tt.quota,
      sold,
      checkedIn,
      reservedActive,
      available: available < 0 ? 0 : available
    };
  });

  return {
    event: {
      id: event.id,
      name: event.name,
      slug: event.slug,
      timezone: event.timezone,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString()
    },
    kpis: {
      ordersPaid: ordersPaidAgg._count._all,
      revenuePaidCents: ordersPaidAgg._sum.totalCents ?? 0,
      ticketsSold,
      checkins,
      reservationsActive: reservationsActive._sum.quantity ?? 0,
      latePaymentReviewRequired
    },
    salesSeries: salesSeries.map((row) => ({
      bucketStart: new Date(row.bucketStartLocal).toISOString(),
      ordersPaid: Number(row.ordersPaid),
      revenuePaidCents: Number(row.revenuePaidCents)
    })),
    byTicketType,
    recentScans: recentScans.map((scan) => ({
      id: scan.id,
      ticketId: scan.ticketId,
      scannedAt: scan.scannedAt.toISOString(),
      result: scan.result,
      reason: scan.reason,
      gate: scan.gate,
      scannedByEmail: scan.scannedBy?.email ?? null
    })),
    alerts: {
      latePaymentReviewRequired,
      recentEmailFailures
    },
    activity: activity.map((item) => ({
      id: item.id,
      type: item.type,
      occurredAt: item.occurredAt.toISOString(),
      actorType: item.actorType,
      actorId: item.actorId,
      aggregateType: item.aggregateType,
      aggregateId: item.aggregateId,
      correlationId: item.correlationId,
      payload: item.payload
    }))
  };
}
