import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import { hasIntegrationEnv } from "../modules/payments/integrationTestEnv.js";
import { releaseExpiredReservations } from "./releaseExpiredReservations.js";

describe.skipIf(!hasIntegrationEnv)("releaseExpiredReservations", () => {
  const created = {
    organizerIds: [] as string[],
    eventIds: [] as string[],
    ticketTypeIds: [] as string[],
    orderIds: [] as string[],
    reservationIds: [] as string[]
  };

  afterAll(async () => {
    if (created.reservationIds.length > 0) {
      await prisma.inventoryReservation.deleteMany({ where: { id: { in: created.reservationIds } } });
    }
    if (created.orderIds.length > 0) {
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

  async function seedExpiredReservation(params?: { releasedAt?: Date | null; remaining?: number; quantity?: number }) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const quantity = params?.quantity ?? 2;

    const organizer = await prisma.organizer.create({
      data: {
        name: `TTL Org ${suffix}`,
        slug: `ttl-org-${suffix}`,
        serviceFeeBps: 0,
        taxBps: 0
      }
    });
    created.organizerIds.push(organizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `TTL Event ${suffix}`,
        slug: `ttl-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 100,
        visibility: "published"
      }
    });
    created.eventIds.push(event.id);

    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: "General",
        priceCents: 1000,
        currency: "ARS",
        quota: 10,
        remaining: params?.remaining ?? 8,
        maxPerOrder: 10
      }
    });
    created.ticketTypeIds.push(ticketType.id);

    const order = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        customerEmail: `ttl-${suffix}@test.local`,
        status: "reserved",
        orderNumber: `TTL-${suffix}`,
        subtotalCents: 1000 * quantity,
        totalCents: 1000 * quantity,
        feeCents: 0,
        taxCents: 0,
        reservedUntil: new Date(Date.now() - 5 * 60 * 1000),
        items: {
          create: [{
            ticketTypeId: ticketType.id,
            quantity,
            unitPriceCents: 1000,
            totalCents: 1000 * quantity
          }]
        },
        reservations: {
          create: [{
            ticketTypeId: ticketType.id,
            quantity,
            expiresAt: new Date(Date.now() - 5 * 60 * 1000),
            releasedAt: params?.releasedAt ?? null,
            releaseReason: params?.releasedAt ? "manual_pre_release" : null
          }]
        }
      },
      include: { reservations: true }
    });
    created.orderIds.push(order.id);
    created.reservationIds.push(...order.reservations.map((reservation) => reservation.id));

    return { organizer, event, ticketType, order, reservation: order.reservations[0] };
  }

  it("expiración simple restituye stock y expira order", async () => {
    const seeded = await seedExpiredReservation({ remaining: 8, quantity: 2 });

    const summary = await releaseExpiredReservations(new Date());

    const ticketType = await prisma.ticketType.findUniqueOrThrow({ where: { id: seeded.ticketType.id } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: seeded.order.id } });
    const reservation = await prisma.inventoryReservation.findUniqueOrThrow({ where: { id: seeded.reservation.id } });

    expect(summary.expiredOrders).toBeGreaterThanOrEqual(1);
    expect(summary.releasedReservations).toBeGreaterThanOrEqual(1);
    expect(summary.restoredUnits).toBeGreaterThanOrEqual(2);
    expect(ticketType.remaining).toBe(10);
    expect(order.status).toBe("expired");
    expect(reservation.releasedAt).toBeTruthy();
    expect(reservation.releaseReason).toBe("expired_ttl");
  });

  it("doble ejecución del job no duplica restitución", async () => {
    const seeded = await seedExpiredReservation({ remaining: 7, quantity: 3 });

    const first = await releaseExpiredReservations(new Date());
    const second = await releaseExpiredReservations(new Date(Date.now() + 1000));

    const ticketType = await prisma.ticketType.findUniqueOrThrow({ where: { id: seeded.ticketType.id } });
    expect(first.restoredUnits).toBeGreaterThanOrEqual(3);
    expect(second.restoredUnits).toBe(0);
    expect(ticketType.remaining).toBe(10);
  });

  it("reservations ya liberadas no vuelven a tocar stock", async () => {
    const seeded = await seedExpiredReservation({ remaining: 8, quantity: 2, releasedAt: new Date(Date.now() - 60_000) });

    const summary = await releaseExpiredReservations(new Date());

    const ticketType = await prisma.ticketType.findUniqueOrThrow({ where: { id: seeded.ticketType.id } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: seeded.order.id } });
    expect(summary.restoredUnits).toBe(0);
    expect(summary.skippedAlreadyReleased).toBeGreaterThanOrEqual(1);
    expect(ticketType.remaining).toBe(8);
    expect(order.status).toBe("expired");
  });
});
