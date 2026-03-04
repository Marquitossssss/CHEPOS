import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";

if (!process.env.API_PORT) process.env.API_PORT = "3399";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

const provider = "test-provider";
const baseUrl = `http://127.0.0.1:${process.env.API_PORT}`;
let created = {
  organizerId: "",
  eventId: "",
  ticketTypeId: "",
  orderId: "",
  providerEventId: "",
  providerRef: ""
};

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy in time");
}

const stateMachineEnabled = process.env.PAYMENTS_STATE_MACHINE_ENABLED === "true";

// This integration test validates paid-transition concurrency semantics.
// Keep it gated until PR3 (state machine) is active in the target branch.
// Enable with PAYMENTS_STATE_MACHINE_ENABLED=true.
describe.skipIf(!stateMachineEnabled)("webhook concurrency", () => {
  beforeAll(async () => {
    expect(process.env.DATABASE_URL, "DATABASE_URL is required for webhook concurrency integration test").toBeTruthy();

    await import("../../server.js");
    await waitForHealth();

    const suffix = Date.now().toString();
    const organizer = await prisma.organizer.create({
      data: {
        name: `Race Org ${suffix}`,
        slug: `race-org-${suffix}`,
        serviceFeeBps: 0,
        taxBps: 0
      }
    });

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Race Event ${suffix}`,
        slug: `race-event-${suffix}`,
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
        priceCents: 1000,
        currency: "ARS",
        quota: 100,
        maxPerOrder: 10
      }
    });

    const order = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        customerEmail: "race@test.local",
        status: "pending",
        orderNumber: `RACE-${suffix}`,
        subtotalCents: 1000,
        totalCents: 1000,
        feeCents: 0,
        taxCents: 0,
        items: {
          create: [{
            ticketTypeId: ticketType.id,
            quantity: 1,
            unitPriceCents: 1000,
            totalCents: 1000
          }]
        }
      }
    });

    created = {
      organizerId: organizer.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      orderId: order.id,
      providerEventId: `race-test-${suffix}`,
      providerRef: `provider-ref-${suffix}`
    };
  });

  afterAll(async () => {
    if (!created.orderId) return;

    await prisma.domainEvent.deleteMany({ where: { orderId: created.orderId } });
    await prisma.ticket.deleteMany({ where: { orderId: created.orderId } });
    await prisma.payment.deleteMany({ where: { orderId: created.orderId } });
    await prisma.paymentProviderEvent.deleteMany({ where: { provider, providerEventId: created.providerEventId } });
    await prisma.paymentIdempotencyKey.deleteMany({ where: { provider, idempotencyKey: created.providerEventId } });
    await prisma.orderItem.deleteMany({ where: { orderId: created.orderId } });
    await prisma.inventoryReservation.deleteMany({ where: { orderId: created.orderId } });
    await prisma.order.deleteMany({ where: { id: created.orderId } });
    await prisma.ticketType.deleteMany({ where: { id: created.ticketTypeId } });
    await prisma.event.deleteMany({ where: { id: created.eventId } });
    await prisma.organizer.deleteMany({ where: { id: created.organizerId } });
  });

  it("processes duplicate provider event exactly once under race", async () => {
    const payload = {
      externalEventId: created.providerEventId,
      orderId: created.orderId,
      status: "paid",
      providerPaymentId: created.providerRef
    };

    const previousBarrier = process.env.PAYMENTS_CONCURRENCY_TEST_BARRIER_MS;
    process.env.PAYMENTS_CONCURRENCY_TEST_BARRIER_MS = "50";

    try {
      const [r1, r2] = await Promise.all([
        fetch(`${baseUrl}/webhooks/payments/${provider}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        }),
        fetch(`${baseUrl}/webhooks/payments/${provider}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        })
      ]);

      expect(r1.status).toBeLessThan(300);
      expect(r2.status).toBeLessThan(300);

      const b1 = await r1.json();
      const b2 = await r2.json();
      const isExpectedSecondary = (b1?.deduped || b1?.inFlight || b2?.deduped || b2?.inFlight);
      expect(isExpectedSecondary).toBe(true);

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: created.orderId },
        include: { tickets: true }
      });

      expect(order.status).toBe("paid");
      expect(order.tickets.length).toBe(1);

      const providerEvents = await prisma.paymentProviderEvent.findMany({
        where: { provider, providerEventId: created.providerEventId }
      });
      expect(providerEvents.length).toBe(1);
      expect(providerEvents[0].status).toBe("processed");

      const payments = await prisma.payment.findMany({
        where: { orderId: created.orderId, provider, providerRef: created.providerRef }
      });
      expect(payments.length).toBe(1);
    } finally {
      if (previousBarrier == null) {
        delete process.env.PAYMENTS_CONCURRENCY_TEST_BARRIER_MS;
      } else {
        process.env.PAYMENTS_CONCURRENCY_TEST_BARRIER_MS = previousBarrier;
      }
    }
  });
});
