import { prisma } from "../../lib/prisma.js";

type JwtPayload = { userId: string; email: string };

type DbClient = typeof prisma;

export type OpsDashboardDTO = {
  window24h: {
    ordersTotal: number;
    paid: number;
    pending: number;
    expired: number;
    grossAmount: number;
    netAmount: number;
  };
  window7d: {
    ordersTotal: number;
    paid: number;
    grossAmount: number;
    netAmount: number;
  };
  risk: {
    latePaymentCases: number;
    reservationsExpiringSoon: number;
  };
  activity: Array<{
    id: string;
    type: string;
    aggregateId: string;
    createdAt: string;
  }>;
};

const NET_FACTOR = 0.97;

export async function buildOpsDashboard(user: JwtPayload, organizerId: string, db: DbClient = prisma): Promise<OpsDashboardDTO> {
  const membership = await db.membership.findUnique({
    where: { userId_organizerId: { userId: user.userId, organizerId } },
    select: { role: true }
  });

  if (!membership) throw new Error("FORBIDDEN");

  const now = new Date();
  const from24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const from7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const expiringSoon = new Date(now.getTime() + 30 * 60 * 1000);

  const [
    window24hOrders,
    window7dOrders,
    latePaymentCases,
    reservationsExpiringSoon,
    activity
  ] = await Promise.all([
    db.order.groupBy({
      by: ["status"],
      where: {
        organizerId,
        createdAt: { gte: from24h }
      },
      _count: { _all: true },
      _sum: { totalCents: true }
    }),
    db.order.groupBy({
      by: ["status"],
      where: {
        organizerId,
        createdAt: { gte: from7d }
      },
      _count: { _all: true },
      _sum: { totalCents: true }
    }),
    db.latePaymentCase.count({
      where: {
        status: "PENDING",
        order: { organizerId }
      }
    }),
    db.inventoryReservation.count({
      where: {
        releasedAt: null,
        expiresAt: { gt: now, lte: expiringSoon },
        order: { organizerId }
      }
    }),
    db.domainEvent.findMany({
      where: { organizerId },
      orderBy: { occurredAt: "desc" },
      take: 10,
      select: {
        id: true,
        type: true,
        aggregateId: true,
        occurredAt: true
      }
    })
  ]);

  const c24 = new Map(window24hOrders.map((row) => [row.status, row._count._all]));
  const c7 = new Map(window7dOrders.map((row) => [row.status, row._count._all]));

  const gross24h = window24hOrders.reduce((acc, row) => acc + (row._sum.totalCents ?? 0), 0);
  const gross7d = window7dOrders.reduce((acc, row) => acc + (row._sum.totalCents ?? 0), 0);

  return {
    window24h: {
      ordersTotal: window24hOrders.reduce((acc, row) => acc + row._count._all, 0),
      paid: c24.get("paid") ?? 0,
      pending: c24.get("pending") ?? 0,
      expired: c24.get("expired") ?? 0,
      grossAmount: gross24h,
      netAmount: Math.floor(gross24h * NET_FACTOR)
    },
    window7d: {
      ordersTotal: window7dOrders.reduce((acc, row) => acc + row._count._all, 0),
      paid: c7.get("paid") ?? 0,
      grossAmount: gross7d,
      netAmount: Math.floor(gross7d * NET_FACTOR)
    },
    risk: {
      latePaymentCases,
      reservationsExpiringSoon
    },
    activity: activity.map((item) => ({
      id: item.id,
      type: item.type,
      aggregateId: item.aggregateId,
      createdAt: item.occurredAt.toISOString()
    }))
  };
}
