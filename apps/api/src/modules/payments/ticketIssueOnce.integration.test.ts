import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "./integrationTestEnv.js";

if (!process.env.API_PORT) process.env.API_PORT = "3425";
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

describe.skipIf(!hasIntegrationEnv)("ticket issue once defense-in-depth", () => {
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
      await prisma.latePaymentCase.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.paymentEvent.deleteMany({ where: { provider, providerEventId: { in: created.providerEventIds } } });
      await prisma.payment.deleteMany({ where: { orderId: { in: created.orderIds } } });
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

  async function seedOrder(params?: { quantity?: number; expired?: boolean }) {
    const quantity = params?.quantity ?? 2;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organizer = await prisma.organizer.create({
      data: {
        name: `IssueOnce Org ${suffix}`,
        slug: `issueonce-org-${suffix}`,
        serviceFeeBps: 0,
        taxBps: 0
      }
    });
    created.organizerIds.push(organizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `IssueOnce Event ${suffix}`,
        slug: `issueonce-event-${suffix}`,
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
        quota: 100,
        remaining: 100 - quantity,
        maxPerOrder: 10
      }
    });
    created.ticketTypeIds.push(ticketType.id);

    const reservedUntil = params?.expired
      ? new Date(Date.now() - 60_000)
      : new Date(Date.now() + 10 * 60 * 1000);

    const order = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        customerEmail: `issueonce-${suffix}@test.local`,
        status: "reserved",
        orderNumber: `ISS-${suffix}`,
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

    return { organizer, event, ticketType, order, quantity };
  }

  async function getState(orderId: string) {
    const [order, payments, tickets, paidEvents, ticketsEvents, paymentEvents] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: orderId } }),
      prisma.payment.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } }),
      prisma.ticket.findMany({ where: { orderId }, orderBy: { issuedAt: "asc" } }),
      prisma.domainEvent.count({ where: { orderId, type: "ORDER_PAID" } }),
      prisma.domainEvent.count({ where: { orderId, type: "TICKETS_ISSUED" } }),
      prisma.paymentEvent.findMany({ where: { orderId }, orderBy: { receivedAt: "asc" } })
    ]);

    return { order, payments, tickets, paidEvents, ticketsEvents, paymentEvents };
  }

  it("1) confirm retry con mismo clientRequestId no duplica tickets", async () => {
    const seeded = await seedOrder({ quantity: 2 });
    const clientRequestId = `confirm-retry-${Date.now()}`;
    const paymentReference = `pref-retry-${Date.now()}`;

    const first = await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientRequestId, orderId: seeded.order.id, paymentReference })
    });
    const second = await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientRequestId, orderId: seeded.order.id, paymentReference })
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const state = await getState(seeded.order.id);
    expect(state.order.status).toBe("paid");
    expect(state.payments).toHaveLength(1);
    expect(state.tickets).toHaveLength(seeded.quantity);
    expect(state.paidEvents).toBe(1);
    expect(state.ticketsEvents).toBe(1);
  });

  it("2) webhook duplicate envelope no duplica tickets", async () => {
    const seeded = await seedOrder({ quantity: 2 });
    const providerEventId = `evt-dup-${Date.now()}`;
    created.providerEventIds.push(providerEventId);

    const first = await fetch(`${baseUrl}/webhooks/payments/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: providerEventId,
        type: "payment.succeeded",
        data: { id: `pay-dup-${Date.now()}`, metadata: { orderId: seeded.order.id } }
      })
    });
    const second = await fetch(`${baseUrl}/webhooks/payments/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: providerEventId,
        type: "payment.succeeded",
        data: { id: `pay-dup-${Date.now()}`, metadata: { orderId: seeded.order.id } }
      })
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.deduped).toBe(true);

    const state = await getState(seeded.order.id);
    expect(state.order.status).toBe("paid");
    expect(state.payments).toHaveLength(1);
    expect(state.tickets).toHaveLength(seeded.quantity);
    expect(state.paidEvents).toBe(1);
    expect(state.ticketsEvents).toBe(1);
    expect(state.paymentEvents).toHaveLength(1);
  });

  it("3) confirm y webhook compitiendo no duplican tickets", async () => {
    const seeded = await seedOrder({ quantity: 2 });
    const strongRef = `same-${Date.now()}-issue`;
    const providerEventId = `evt-issue-${Date.now()}`;
    created.providerEventIds.push(providerEventId);

    const [confirm, webhook] = await Promise.all([
      fetch(`${baseUrl}/checkout/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: `crid-issue-${Date.now()}`,
          orderId: seeded.order.id,
          paymentReference: strongRef
        })
      }),
      fetch(`${baseUrl}/webhooks/payments/${provider}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: providerEventId,
          type: "payment.succeeded",
          data: { id: strongRef, metadata: { orderId: seeded.order.id } }
        })
      })
    ]);

    expect(confirm.status).toBe(200);
    expect(webhook.status).toBe(200);

    const state = await getState(seeded.order.id);
    expect(state.order.status).toBe("paid");
    expect(state.payments).toHaveLength(1);
    expect(state.tickets).toHaveLength(seeded.quantity);
    expect(state.paidEvents).toBe(1);
    expect(state.ticketsEvents).toBe(1);
  });

  it("4) late payment path no emite tickets", async () => {
    const seeded = await seedOrder({ quantity: 2, expired: true });
    const providerEventId = `evt-late-${Date.now()}`;
    created.providerEventIds.push(providerEventId);

    const webhook = await fetch(`${baseUrl}/webhooks/payments/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: providerEventId,
        type: "payment.succeeded",
        data: { id: `pay-late-${Date.now()}`, metadata: { orderId: seeded.order.id } }
      })
    });

    expect(webhook.status).toBe(200);

    const state = await getState(seeded.order.id);
    expect(state.order.status).toBe("paid_no_stock");
    expect(state.payments).toHaveLength(1);
    expect(state.tickets).toHaveLength(0);
    expect(state.paidEvents).toBe(0);
    expect(state.ticketsEvents).toBe(0);
  });
});
