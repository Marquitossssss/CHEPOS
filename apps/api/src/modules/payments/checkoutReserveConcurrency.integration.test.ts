import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "./integrationTestEnv.js";
import { releaseExpiredReservations } from "../../jobs/releaseExpiredReservations.js";

if (!process.env.API_PORT) process.env.API_PORT = "3423";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.PAYMENTS_WEBHOOK_SECRET ||= "test-webhook-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

const baseUrl = `http://127.0.0.1:${process.env.API_PORT}`;

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy in time");
}

describe.skipIf(!hasIntegrationEnv)("checkout reserve concurrency", () => {
  const created: {
    organizerIds: string[];
    eventIds: string[];
    ticketTypeIds: string[];
    orderIds: string[];
  } = {
    organizerIds: [],
    eventIds: [],
    ticketTypeIds: [],
    orderIds: []
  };

  beforeAll(async () => {
    await import("../../server.js");
    await waitForHealth();
  });

  afterAll(async () => {
    if (created.orderIds.length > 0) {
      await prisma.reserveIdempotencyKey.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.domainEvent.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.inventoryReservation.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
    }

    if (created.ticketTypeIds.length > 0) {
      await prisma.ticketType.deleteMany({ where: { id: { in: created.ticketTypeIds } } });
    }
    if (created.eventIds.length > 0) {
      await prisma.event.deleteMany({ where: { id: { in: created.eventIds } } });
    }
    if (created.organizerIds.length > 0) {
      await prisma.organizer.deleteMany({ where: { id: { in: created.organizerIds } } });
    }
  });

  async function seedReserveFixture(params?: { remaining?: number; quota?: number; maxPerOrder?: number }) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organizer = await prisma.organizer.create({
      data: {
        name: `Reserve Org ${suffix}`,
        slug: `reserve-org-${suffix}`,
        serviceFeeBps: 0,
        taxBps: 0
      }
    });
    created.organizerIds.push(organizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Reserve Event ${suffix}`,
        slug: `reserve-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 100,
        visibility: "published"
      }
    });
    created.eventIds.push(event.id);

    const quota = params?.quota ?? 2;
    const remaining = params?.remaining ?? quota;
    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: "General",
        priceCents: 1500,
        currency: "ARS",
        quota,
        remaining,
        maxPerOrder: params?.maxPerOrder ?? 10
      }
    });
    created.ticketTypeIds.push(ticketType.id);

    return { organizer, event, ticketType };
  }

  async function reserve(input: {
    organizerId: string;
    eventId: string;
    ticketTypeId: string;
    quantity: number;
    clientRequestId: string;
    customerEmail: string;
  }) {
    const response = await fetch(`${baseUrl}/checkout/reserve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: input.clientRequestId,
        organizerId: input.organizerId,
        eventId: input.eventId,
        customerEmail: input.customerEmail,
        items: [{ ticketTypeId: input.ticketTypeId, quantity: input.quantity }]
      })
    });

    let body: any = null;
    try {
      body = await response.json();
    } catch {}

    return { status: response.status, body };
  }

  async function trackOrderId(orderId: string | undefined) {
    if (orderId) created.orderIds.push(orderId);
  }

  it("1) dos reservas concurrentes por último cupo => una gana y la otra pierde sin oversell", async () => {
    const seeded = await seedReserveFixture({ quota: 1, remaining: 1, maxPerOrder: 1 });

    const [a, b] = await Promise.all([
      reserve({
        organizerId: seeded.organizer.id,
        eventId: seeded.event.id,
        ticketTypeId: seeded.ticketType.id,
        quantity: 1,
        clientRequestId: `reserve-race-a-${Date.now()}`,
        customerEmail: `a-${Date.now()}@test.local`
      }),
      reserve({
        organizerId: seeded.organizer.id,
        eventId: seeded.event.id,
        ticketTypeId: seeded.ticketType.id,
        quantity: 1,
        clientRequestId: `reserve-race-b-${Date.now()}`,
        customerEmail: `b-${Date.now()}@test.local`
      })
    ]);

    await trackOrderId(a.body?.id);
    await trackOrderId(b.body?.id);

    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([200, 400]);

    const [ticketType, orders, reservations, activeReservations] = await Promise.all([
      prisma.ticketType.findUniqueOrThrow({ where: { id: seeded.ticketType.id } }),
      prisma.order.findMany({ where: { eventId: seeded.event.id } }),
      prisma.inventoryReservation.findMany({ where: { ticketTypeId: seeded.ticketType.id } }),
      prisma.inventoryReservation.aggregate({
        where: { ticketTypeId: seeded.ticketType.id, releasedAt: null },
        _sum: { quantity: true }
      })
    ]);

    expect(orders).toHaveLength(1);
    expect(reservations).toHaveLength(1);
    expect(ticketType.remaining).toBe(0);
    expect(activeReservations._sum.quantity ?? 0).toBe(1);
  });

  it("2) replay concurrente con mismo clientRequestId => misma order, una sola reserva, remaining consistente", async () => {
    const seeded = await seedReserveFixture({ quota: 2, remaining: 2 });
    const clientRequestId = `reserve-same-${Date.now()}`;

    const [a, b] = await Promise.all([
      reserve({
        organizerId: seeded.organizer.id,
        eventId: seeded.event.id,
        ticketTypeId: seeded.ticketType.id,
        quantity: 1,
        clientRequestId,
        customerEmail: `same-a-${Date.now()}@test.local`
      }),
      reserve({
        organizerId: seeded.organizer.id,
        eventId: seeded.event.id,
        ticketTypeId: seeded.ticketType.id,
        quantity: 1,
        clientRequestId,
        customerEmail: `same-b-${Date.now()}@test.local`
      })
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body?.id).toBeTruthy();
    expect(a.body?.id).toBe(b.body?.id);
    await trackOrderId(a.body?.id);

    const [orders, reservations, idempotencyKeys, ticketType] = await Promise.all([
      prisma.order.findMany({ where: { eventId: seeded.event.id } }),
      prisma.inventoryReservation.findMany({ where: { ticketTypeId: seeded.ticketType.id } }),
      prisma.reserveIdempotencyKey.findMany({ where: { clientRequestId } }),
      prisma.ticketType.findUniqueOrThrow({ where: { id: seeded.ticketType.id } })
    ]);

    expect(orders).toHaveLength(1);
    expect(reservations).toHaveLength(1);
    expect(idempotencyKeys).toHaveLength(1);
    expect(ticketType.remaining).toBe(1);
  });

  it("3) dos órdenes concurrentes distintas sobre stock=2 consumen exactamente 2 unidades y no más", async () => {
    const seeded = await seedReserveFixture({ quota: 2, remaining: 2, maxPerOrder: 2 });

    const [a, b] = await Promise.all([
      reserve({
        organizerId: seeded.organizer.id,
        eventId: seeded.event.id,
        ticketTypeId: seeded.ticketType.id,
        quantity: 1,
        clientRequestId: `reserve-distinct-a-${Date.now()}`,
        customerEmail: `distinct-a-${Date.now()}@test.local`
      }),
      reserve({
        organizerId: seeded.organizer.id,
        eventId: seeded.event.id,
        ticketTypeId: seeded.ticketType.id,
        quantity: 1,
        clientRequestId: `reserve-distinct-b-${Date.now()}`,
        customerEmail: `distinct-b-${Date.now()}@test.local`
      })
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body?.id).not.toBe(b.body?.id);
    await trackOrderId(a.body?.id);
    await trackOrderId(b.body?.id);

    const [ticketType, orders, reservations, activeReservations] = await Promise.all([
      prisma.ticketType.findUniqueOrThrow({ where: { id: seeded.ticketType.id } }),
      prisma.order.findMany({ where: { eventId: seeded.event.id } }),
      prisma.inventoryReservation.findMany({ where: { ticketTypeId: seeded.ticketType.id, releasedAt: null } }),
      prisma.inventoryReservation.aggregate({
        where: { ticketTypeId: seeded.ticketType.id, releasedAt: null },
        _sum: { quantity: true }
      })
    ]);

    expect(orders).toHaveLength(2);
    expect(reservations).toHaveLength(2);
    expect(activeReservations._sum.quantity ?? 0).toBe(2);
    expect(ticketType.remaining).toBe(0);
  });

  it("4) reserve seguido de TTL release restaura remaining sin duplicar liberación", async () => {
    const seeded = await seedReserveFixture({ quota: 2, remaining: 2 });

    const reserved = await reserve({
      organizerId: seeded.organizer.id,
      eventId: seeded.event.id,
      ticketTypeId: seeded.ticketType.id,
      quantity: 1,
      clientRequestId: `reserve-ttl-${Date.now()}`,
      customerEmail: `ttl-${Date.now()}@test.local`
    });

    expect(reserved.status).toBe(200);
    await trackOrderId(reserved.body?.id);

    await prisma.order.update({
      where: { id: reserved.body.id },
      data: { reservedUntil: new Date(Date.now() - 60_000) }
    });
    await prisma.inventoryReservation.updateMany({
      where: { orderId: reserved.body.id, releasedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) }
    });

    const first = await releaseExpiredReservations(new Date());
    const second = await releaseExpiredReservations(new Date(Date.now() + 1000));

    const [ticketType, order, reservation] = await Promise.all([
      prisma.ticketType.findUniqueOrThrow({ where: { id: seeded.ticketType.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: reserved.body.id } }),
      prisma.inventoryReservation.findFirstOrThrow({ where: { orderId: reserved.body.id } })
    ]);

    expect(first.restoredUnits).toBeGreaterThanOrEqual(1);
    expect(second.restoredUnits).toBe(0);
    expect(ticketType.remaining).toBe(2);
    expect(order.status).toBe("expired");
    expect(reservation.releasedAt).toBeTruthy();
    expect(reservation.releaseReason).toBe("expired_ttl");
  });
});
