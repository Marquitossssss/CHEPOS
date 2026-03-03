import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma.js";

if (!process.env.API_PORT) process.env.API_PORT = "3401";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

const baseUrl = `http://127.0.0.1:${process.env.API_PORT}`;
const createdOrderIds: string[] = [];
let organizerId = "";
let eventId = "";
let ticketTypeId = "";

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy in time");
}

async function createOrder(suffix: string) {
  const order = await prisma.order.create({
    data: {
      organizerId,
      eventId,
      customerEmail: `${suffix}@test.local`,
      status: "pending",
      orderNumber: `MP-${suffix}-${Date.now()}`,
      subtotalCents: 1000,
      totalCents: 1000,
      feeCents: 0,
      taxCents: 0,
      items: { create: [{ ticketTypeId, quantity: 1, unitPriceCents: 1000, totalCents: 1000 }] }
    }
  });
  createdOrderIds.push(order.id);
  return order;
}

describe("mercadopago webhook idempotency + reconcile", () => {
  beforeAll(async () => {
    await import("../../server.js");
    await waitForHealth();

    const suffix = Date.now().toString();
    const organizer = await prisma.organizer.create({ data: { name: `MP Org ${suffix}`, slug: `mp-org-${suffix}` } });
    organizerId = organizer.id;
    const event = await prisma.event.create({
      data: {
        organizerId,
        name: `MP Event ${suffix}`,
        slug: `mp-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 3600000),
        endsAt: new Date(Date.now() + 7200000),
        capacity: 100,
        visibility: "published"
      }
    });
    eventId = event.id;
    const ticketType = await prisma.ticketType.create({
      data: { eventId, name: "General", priceCents: 1000, currency: "ARS", quota: 100, maxPerOrder: 10 }
    });
    ticketTypeId = ticketType.id;
  });

  afterAll(async () => {
    await prisma.webhookReceipt.deleteMany({ where: { provider: "mercadopago" } });
    await prisma.paymentAttempt.deleteMany({ where: { provider: "mercadopago" } });
    for (const id of createdOrderIds) {
      await prisma.domainEvent.deleteMany({ where: { orderId: id } });
      await prisma.ticket.deleteMany({ where: { orderId: id } });
      await prisma.payment.deleteMany({ where: { orderId: id } });
      await prisma.orderItem.deleteMany({ where: { orderId: id } });
      await prisma.inventoryReservation.deleteMany({ where: { orderId: id } });
      await prisma.order.deleteMany({ where: { id } });
    }
    if (ticketTypeId) await prisma.ticketType.deleteMany({ where: { id: ticketTypeId } });
    if (eventId) await prisma.event.deleteMany({ where: { id: eventId } });
    if (organizerId) await prisma.organizer.deleteMany({ where: { id: organizerId } });
  });

  it("webhook duplicado procesa una sola transición/attempt/receipt", async () => {
    const order = await createOrder("dup");
    const payload = { id: `evt-${Date.now()}`, data: { id: `pay-${Date.now()}` }, orderId: order.id, status: "approved" };

    const r1 = await fetch(`${baseUrl}/webhooks/mercadopago`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const r2 = await fetch(`${baseUrl}/webhooks/mercadopago`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const receipts = await prisma.webhookReceipt.findMany({ where: { provider: "mercadopago", providerEventId: payload.id } });
    const attempts = await prisma.paymentAttempt.findMany({ where: { provider: "mercadopago", providerPaymentId: payload.data.id } });
    const orderDb = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true } });

    expect(receipts.length).toBe(1);
    expect(attempts.length).toBe(1);
    expect(orderDb.status).toBe("paid");
    expect(orderDb.tickets.length).toBe(1);
  });

  it("concurrencia: 2 requests mismo providerPaymentId no duplican tickets", async () => {
    const order = await createOrder("race");
    const providerPaymentId = `pay-race-${Date.now()}`;
    const p1 = { id: `evt-a-${Date.now()}`, data: { id: providerPaymentId }, orderId: order.id, status: "approved" };
    const p2 = { id: `evt-b-${Date.now()}`, data: { id: providerPaymentId }, orderId: order.id, status: "approved" };

    const [r1, r2] = await Promise.all([
      fetch(`${baseUrl}/webhooks/mercadopago`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p1) }),
      fetch(`${baseUrl}/webhooks/mercadopago`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p2) })
    ]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const attempts = await prisma.paymentAttempt.findMany({ where: { provider: "mercadopago", providerPaymentId } });
    const orderDb = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true } });
    expect(attempts.length).toBe(1);
    expect(orderDb.tickets.length).toBe(1);
  });

  it("reconciliación sin webhook marca paid", async () => {
    const order = await createOrder("reconcile");
    const providerPaymentId = `pay-rec-${Date.now()}`;
    await prisma.paymentAttempt.create({
      data: {
        provider: "mercadopago",
        providerPaymentId,
        orderId: order.id,
        status: "pending",
        rawPayload: { source: "test" },
        lastSeenAt: new Date(Date.now() - 15 * 60 * 1000)
      }
    });

    vi.doMock("./mercadopago-provider.js", () => ({
      fetchMercadoPagoPayment: vi.fn(async () => ({ id: providerPaymentId, status: "approved", external_reference: order.id }))
    }));

    const { runPaymentsReconciliationCycle } = await import("./reconcile-payments.js");
    await runPaymentsReconciliationCycle();

    const orderDb = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderDb.status).toBe("paid");
  });

  it("webhook tardío con order ya paid no re-emite tickets", async () => {
    const order = await createOrder("late");
    const providerPaymentId = `pay-late-${Date.now()}`;
    const first = { id: `evt-first-${Date.now()}`, data: { id: providerPaymentId }, orderId: order.id, status: "approved" };
    await fetch(`${baseUrl}/webhooks/mercadopago`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(first) });

    const before = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true } });
    const late = { id: `evt-late-${Date.now()}`, data: { id: providerPaymentId }, orderId: order.id, status: "approved" };
    const resp = await fetch(`${baseUrl}/webhooks/mercadopago`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(late) });
    expect(resp.status).toBe(200);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true } });
    expect(after.status).toBe("paid");
    expect(after.tickets.length).toBe(before.tickets.length);
  });
});
