import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";

if (!process.env.API_PORT) process.env.API_PORT = "3420";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

const hasDb = Boolean(process.env.DATABASE_URL);
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

describe.skipIf(!hasDb)("checkout confirm idempotency contract", () => {
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
    if (created.orderIds.length === 0) return;

    await prisma.confirmIdempotencyKey.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.domainEvent.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.ticketScan.deleteMany({ where: { eventId: { in: created.eventIds } } });
    await prisma.ticket.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.inventoryReservation.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
    await prisma.ticketType.deleteMany({ where: { id: { in: created.ticketTypeIds } } });
    await prisma.event.deleteMany({ where: { id: { in: created.eventIds } } });
    await prisma.organizer.deleteMany({ where: { id: { in: created.organizerIds } } });
  });

  async function seedOrder(params?: { status?: "reserved" | "paid"; withPayment?: boolean; withTickets?: boolean; paymentReference?: string }) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const organizer = await prisma.organizer.create({
      data: {
        name: `Confirm Org ${suffix}`,
        slug: `confirm-org-${suffix}`,
        serviceFeeBps: 0,
        taxBps: 0
      }
    });

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Confirm Event ${suffix}`,
        slug: `confirm-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 100,
        visibility: "published"
      }
    });

    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: "General",
        priceCents: 1500,
        currency: "ARS",
        quota: 100,
        remaining: 99,
        maxPerOrder: 10
      }
    });

    const status = params?.status ?? "reserved";

    const order = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        customerEmail: `confirm-${suffix}@test.local`,
        status,
        orderNumber: `CFM-${suffix}`,
        subtotalCents: 1500,
        totalCents: 1500,
        feeCents: 0,
        taxCents: 0,
        reservedUntil: new Date(Date.now() + 10 * 60 * 1000),
        items: {
          create: [{
            ticketTypeId: ticketType.id,
            quantity: 1,
            unitPriceCents: 1500,
            totalCents: 1500
          }]
        },
        reservations: {
          create: [{
            ticketTypeId: ticketType.id,
            quantity: 1,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000)
          }]
        }
      }
    });

    if (params?.withPayment) {
      await prisma.payment.create({
        data: {
          orderId: order.id,
          provider: "mock",
          providerRef: params.paymentReference ?? `pay-${suffix}`,
          status: "paid",
          amountCents: 1500
        }
      });
    }

    if (params?.withTickets) {
      await prisma.ticket.create({
        data: {
          orderId: order.id,
          ticketTypeId: ticketType.id,
          eventId: event.id,
          code: `tk_${suffix}_${Math.random().toString(36).slice(2, 8)}`,
          qrPayload: `tk_${suffix}`,
          status: "issued"
        }
      });
    }

    created.organizerIds.push(organizer.id);
    created.eventIds.push(event.id);
    created.ticketTypeIds.push(ticketType.id);
    created.orderIds.push(order.id);

    return { organizer, event, ticketType, order };
  }

  it("1) mismo clientRequestId + mismo payload => 200 replay, sin segundo payment ni tickets", async () => {
    const seeded = await seedOrder();
    const clientRequestId = `crid-${Date.now()}`;
    const paymentReference = `pref-${Date.now()}`;

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

    const payments = await prisma.payment.findMany({ where: { orderId: seeded.order.id } });
    const tickets = await prisma.ticket.findMany({ where: { orderId: seeded.order.id } });

    expect(payments).toHaveLength(1);
    expect(tickets).toHaveLength(1);
  });

  it("2) mismo clientRequestId + distinto paymentReference => 409 CONFIRM_IDEMPOTENCY_CONFLICT", async () => {
    const seeded = await seedOrder();
    const clientRequestId = `crid-${Date.now()}-2`;

    await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientRequestId, orderId: seeded.order.id, paymentReference: `pref-A-${Date.now()}` })
    });

    const conflict = await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientRequestId, orderId: seeded.order.id, paymentReference: `pref-B-${Date.now()}` })
    });

    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    expect(body.code).toBe("CONFIRM_IDEMPOTENCY_CONFLICT");
  });

  it("3) mismo clientRequestId + distinto orderId => 409 CONFIRM_IDEMPOTENCY_CONFLICT", async () => {
    const a = await seedOrder();
    const b = await seedOrder();
    const clientRequestId = `crid-${Date.now()}-3`;
    const paymentReference = `pref-${Date.now()}-3`;

    await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientRequestId, orderId: a.order.id, paymentReference })
    });

    const conflict = await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientRequestId, orderId: b.order.id, paymentReference })
    });

    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    expect(body.code).toBe("CONFIRM_IDEMPOTENCY_CONFLICT");
  });

  it("4) order paid + mismo paymentReference + nuevo clientRequestId => 200 estable", async () => {
    const paymentReference = `pref-paid-${Date.now()}-4`;
    const seeded = await seedOrder({ status: "paid", withPayment: true, withTickets: true, paymentReference });

    const response = await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: `crid-${Date.now()}-4`,
        orderId: seeded.order.id,
        paymentReference
      })
    });

    expect(response.status).toBe(200);

    const payments = await prisma.payment.findMany({ where: { orderId: seeded.order.id } });
    const tickets = await prisma.ticket.findMany({ where: { orderId: seeded.order.id } });
    expect(payments).toHaveLength(1);
    expect(tickets).toHaveLength(1);
  });

  it("5) order paid + distinto paymentReference + nuevo clientRequestId => 409 CONFIRM_PAYMENT_REFERENCE_MISMATCH", async () => {
    const seeded = await seedOrder({
      status: "paid",
      withPayment: true,
      paymentReference: `pref-paid-${Date.now()}-5-A`
    });

    const response = await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: `crid-${Date.now()}-5`,
        orderId: seeded.order.id,
        paymentReference: `pref-paid-${Date.now()}-5-B`
      })
    });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe("CONFIRM_PAYMENT_REFERENCE_MISMATCH");
  });

  it("6) order paid sin payment asociado => 422 PAID_ORDER_WITHOUT_PAYMENT", async () => {
    const seeded = await seedOrder({ status: "paid", withPayment: false });

    const response = await fetch(`${baseUrl}/checkout/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: `crid-${Date.now()}-6`,
        orderId: seeded.order.id,
        paymentReference: `pref-paid-${Date.now()}-6`
      })
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("PAID_ORDER_WITHOUT_PAYMENT");
  });

  it("7) dos confirm concurrentes misma order => 1 payment, 1 emisión efectiva, paid", async () => {
    const seeded = await seedOrder();
    const sharedReference = `pref-conc-${Date.now()}-7`;

    const [r1, r2] = await Promise.all([
      fetch(`${baseUrl}/checkout/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: `crid-${Date.now()}-7-A`,
          orderId: seeded.order.id,
          paymentReference: sharedReference
        })
      }),
      fetch(`${baseUrl}/checkout/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientRequestId: `crid-${Date.now()}-7-B`,
          orderId: seeded.order.id,
          paymentReference: sharedReference
        })
      })
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: seeded.order.id },
      include: { tickets: true }
    });
    expect(order.status).toBe("paid");
    expect(order.tickets).toHaveLength(1);

    const payments = await prisma.payment.findMany({ where: { orderId: seeded.order.id } });
    expect(payments).toHaveLength(1);

    const paidEvents = await prisma.domainEvent.count({ where: { orderId: seeded.order.id, type: "ORDER_PAID" } });
    const ticketsEvents = await prisma.domainEvent.count({ where: { orderId: seeded.order.id, type: "TICKETS_ISSUED" } });
    expect(paidEvents).toBe(1);
    expect(ticketsEvents).toBe(1);
  });
});
