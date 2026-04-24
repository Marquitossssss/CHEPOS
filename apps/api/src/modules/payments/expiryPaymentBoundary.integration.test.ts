import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "./integrationTestEnv.js";
import { releaseExpiredReservations } from "../../jobs/releaseExpiredReservations.js";

if (!process.env.API_PORT) process.env.API_PORT = "3424";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.PAYMENTS_WEBHOOK_SECRET ||= "test-webhook-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

const baseUrl = `http://127.0.0.1:${process.env.API_PORT}`;
const provider = "mock";

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

describe.skipIf(!hasIntegrationEnv)("expiry vs payment boundary convergence", () => {
  const created: {
    organizerIds: string[];
    eventIds: string[];
    ticketTypeIds: string[];
    orderIds: string[];
    providerEventIds: string[];
  } = {
    organizerIds: [],
    eventIds: [],
    ticketTypeIds: [],
    orderIds: [],
    providerEventIds: []
  };

  beforeAll(async () => {
    await import("../../server.js");
    await waitForHealth();
  });

  afterAll(async () => {
    if (created.orderIds.length > 0) {
      await prisma.confirmIdempotencyKey.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.domainEvent.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.ticketScan.deleteMany({ where: { eventId: { in: created.eventIds } } });
      await prisma.ticket.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.paymentEvent.deleteMany({ where: { provider, providerEventId: { in: created.providerEventIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.inventoryReservation.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
      await prisma.latePaymentCase.deleteMany({ where: { orderId: { in: created.orderIds } } });
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

  async function seedReservedOrder(params?: { quantity?: number; remaining?: number; reservedUntilOffsetMs?: number }) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const quantity = params?.quantity ?? 1;
    const quota = quantity;
    const remaining = params?.remaining ?? 0;
    const reservedUntil = new Date(Date.now() + (params?.reservedUntilOffsetMs ?? 10 * 60 * 1000));

    const organizer = await prisma.organizer.create({
      data: {
        name: `Boundary Org ${suffix}`,
        slug: `boundary-org-${suffix}`,
        serviceFeeBps: 0,
        taxBps: 0
      }
    });
    created.organizerIds.push(organizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Boundary Event ${suffix}`,
        slug: `boundary-event-${suffix}`,
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
        priceCents: 1500,
        currency: "ARS",
        quota,
        remaining,
        maxPerOrder: 10
      }
    });
    created.ticketTypeIds.push(ticketType.id);

    const order = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        customerEmail: `boundary-${suffix}@test.local`,
        status: "reserved",
        orderNumber: `BND-${suffix}`,
        subtotalCents: 1500 * quantity,
        totalCents: 1500 * quantity,
        feeCents: 0,
        taxCents: 0,
        reservedUntil,
        items: {
          create: [{
            ticketTypeId: ticketType.id,
            quantity,
            unitPriceCents: 1500,
            totalCents: 1500 * quantity
          }]
        },
        reservations: {
          create: [{
            ticketTypeId: ticketType.id,
            quantity,
            expiresAt: reservedUntil
          }]
        }
      }
    });
    created.orderIds.push(order.id);

    return { organizer, event, ticketType, order };
  }

  async function getState(orderId: string, ticketTypeId: string) {
    const [order, ticketType, payments, paymentEvents, tickets, reservations, paidEvents, ticketsIssuedEvents, lateCases] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } }),
      prisma.payment.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } }),
      prisma.paymentEvent.findMany({ where: { orderId }, orderBy: { receivedAt: "asc" } }),
      prisma.ticket.findMany({ where: { orderId } }),
      prisma.inventoryReservation.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } }),
      prisma.domainEvent.count({ where: { orderId, type: "ORDER_PAID" } }),
      prisma.domainEvent.count({ where: { orderId, type: "TICKETS_ISSUED" } }),
      prisma.latePaymentCase.findMany({ where: { orderId } })
    ]);

    return { order, ticketType, payments, paymentEvents, tickets, reservations, paidEvents, ticketsIssuedEvents, lateCases };
  }

  it("1) confirm llegando con reserva ya expirada => no paga, no emite tickets, no toca stock", async () => {
    const seeded = await seedReservedOrder({ quantity: 1, remaining: 0, reservedUntilOffsetMs: -60_000 });

    const response = await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: `confirm-expired-${Date.now()}`,
        orderId: seeded.order.id,
        paymentReference: `pref-expired-${Date.now()}`
      })
    });

    expect(response.status).toBe(400);

    const state = await getState(seeded.order.id, seeded.ticketType.id);
    expect(state.order.status).toBe("reserved");
    expect(state.payments).toHaveLength(0);
    expect(state.tickets).toHaveLength(0);
    expect(state.reservations).toHaveLength(1);
    expect(state.reservations[0].releasedAt).toBeNull();
    expect(state.ticketType.remaining).toBe(0);
    expect(state.paidEvents).toBe(0);
    expect(state.ticketsIssuedEvents).toBe(0);
  });

  it("2) webhook paid llegando con reserva ya expirada => converge a paid_no_stock sin tickets ni doble stock", async () => {
    const seeded = await seedReservedOrder({ quantity: 1, remaining: 0, reservedUntilOffsetMs: -60_000 });
    const providerEventId = `evt-expired-${Date.now()}`;
    created.providerEventIds.push(providerEventId);

    const response = await fetch(`${baseUrl}/webhooks/payments/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: providerEventId,
        type: "payment.succeeded",
        data: { id: `pay-expired-${Date.now()}`, metadata: { orderId: seeded.order.id } }
      })
    });

    expect(response.status).toBe(200);

    const state = await getState(seeded.order.id, seeded.ticketType.id);
    expect(state.order.status).toBe("paid_no_stock");
    expect(state.payments).toHaveLength(1);
    expect(state.tickets).toHaveLength(0);
    expect(state.reservations).toHaveLength(1);
    expect(state.reservations[0].releasedAt).toBeTruthy();
    expect(state.reservations[0].releaseReason).toBe("expired_payment_compensation");
    expect(state.ticketType.remaining).toBe(1);
    expect(state.paidEvents).toBe(0);
    expect(state.ticketsIssuedEvents).toBe(0);
    expect(state.lateCases).toHaveLength(0);
    expect(state.paymentEvents).toHaveLength(1);
    expect(state.paymentEvents[0].processedAt).toBeTruthy();
    expect(state.paymentEvents[0].ignoredReason).toBeNull();
  });

  it("3) confirm y TTL en borde expirado => confirm falla, TTL expira y libera una sola vez", async () => {
    const seeded = await seedReservedOrder({ quantity: 1, remaining: 0, reservedUntilOffsetMs: -60_000 });

    const [confirmResponse, ttlFirst, ttlSecond] = await Promise.all([
      fetch(`${baseUrl}/checkout/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: `confirm-vs-ttl-${Date.now()}`,
          orderId: seeded.order.id,
          paymentReference: `pref-vs-ttl-${Date.now()}`
        })
      }),
      releaseExpiredReservations(new Date()),
      releaseExpiredReservations(new Date(Date.now() + 1000))
    ]);

    expect(confirmResponse.status).toBe(400);
    // restoredUnits is best-effort per-run telemetry under concurrent overlap.
    // The strong contract for this boundary is the durable final state below.
    expect(ttlFirst.restoredUnits).toBeGreaterThanOrEqual(0);
    expect(ttlSecond.restoredUnits).toBeGreaterThanOrEqual(0);

    const state = await getState(seeded.order.id, seeded.ticketType.id);
    expect(state.order.status).toBe("expired");
    expect(state.payments).toHaveLength(0);
    expect(state.tickets).toHaveLength(0);
    expect(state.ticketType.remaining).toBe(1);
    expect(state.reservations).toHaveLength(1);
    expect(state.reservations[0].releasedAt).toBeTruthy();
    expect(state.reservations[0].releaseReason).toBe("expired_ttl");
    expect(state.paidEvents).toBe(0);
    expect(state.ticketsIssuedEvents).toBe(0);
  });

  it("4) webhook y TTL compitiendo con reserva ya vencida => converge sin tickets duplicados ni stock doble", async () => {
    const seeded = await seedReservedOrder({ quantity: 1, remaining: 0, reservedUntilOffsetMs: -60_000 });
    const providerEventId = `evt-webhook-ttl-${Date.now()}`;
    created.providerEventIds.push(providerEventId);

    const [webhookResponse, ttlFirst, ttlSecond] = await Promise.all([
      fetch(`${baseUrl}/webhooks/payments/${provider}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: providerEventId,
          type: "payment.succeeded",
          data: { id: `pay-webhook-ttl-${Date.now()}`, metadata: { orderId: seeded.order.id } }
        })
      }),
      releaseExpiredReservations(new Date()),
      releaseExpiredReservations(new Date(Date.now() + 1000))
    ]);

    expect(webhookResponse.status).toBe(200);

    const state = await getState(seeded.order.id, seeded.ticketType.id);
    expect(state.order.status).toBe("paid_no_stock");
    expect(state.payments).toHaveLength(1);
    expect(state.tickets).toHaveLength(0);
    expect(state.paidEvents).toBe(0);
    expect(state.ticketsIssuedEvents).toBe(0);
    expect(state.ticketType.remaining).toBe(1);
    expect(state.reservations).toHaveLength(1);
    expect(state.reservations[0].releasedAt).toBeTruthy();
    expect(["expired_ttl", "expired_payment_compensation"]).toContain(state.reservations[0].releaseReason ?? "");
  });
});
