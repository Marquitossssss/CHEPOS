if (!process.env.API_PORT) process.env.API_PORT = "3429";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "./integrationTestEnv.js";
import type { OrganizerRole } from "@articket/shared";

const baseUrl = `http://127.0.0.1:${process.env.API_PORT}`;

async function getNotificationQueue() {
  return (await import("../notifications/queue.js")).notificationQueue;
}

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

describe.skipIf(!hasIntegrationEnv)("order confirmation resend contract", () => {
  const created = {
    userIds: [] as string[],
    organizerIds: [] as string[],
    eventIds: [] as string[],
    ticketTypeIds: [] as string[],
    orderIds: [] as string[],
    ticketIds: [] as string[],
    paymentIds: [] as string[],
    reservationIds: [] as string[],
    lateCaseIds: [] as string[],
    auditLogIds: [] as string[]
  };

  beforeAll(async () => {
    await import("../../server.js");
    await waitForHealth();
    try {
      const notificationQueue = await getNotificationQueue();
      await notificationQueue.drain(true);
    } catch {}
  });

  afterAll(async () => {
    try {
      const notificationQueue = await getNotificationQueue();
      await notificationQueue.drain(true);
    } catch {}

    if (created.organizerIds.length === 0) return;

    await prisma.auditLog.deleteMany({ where: { id: { in: created.auditLogIds } } });
    await prisma.domainEvent.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.emailEvent.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.latePaymentCase.deleteMany({ where: { id: { in: created.lateCaseIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: created.paymentIds } } });
    await prisma.inventoryReservation.deleteMany({ where: { id: { in: created.reservationIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: created.ticketIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
    await prisma.ticketType.deleteMany({ where: { id: { in: created.ticketTypeIds } } });
    await prisma.event.deleteMany({ where: { id: { in: created.eventIds } } });
    await prisma.membership.deleteMany({ where: { organizerId: { in: created.organizerIds } } });
    await prisma.organizer.deleteMany({ where: { id: { in: created.organizerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  });

  async function createUser(role: OrganizerRole, organizerId: string) {
    const suffix = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `${suffix}@test.local`;
    const password = "Password123!";
    const passwordHash = await bcrypt.hash(password, 4);
    const user = await prisma.user.create({ data: { email, passwordHash } });
    await prisma.membership.create({ data: { userId: user.id, organizerId, role } });
    created.userIds.push(user.id);
    return { user, email, password };
  }

  async function login(email: string, password: string) {
    const r = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    expect(r.status).toBe(200);
    const json = await r.json() as { accessToken: string };
    return json.accessToken;
  }

  async function resend(token: string, orderId: string, body: Record<string, unknown>) {
    return fetch(`${baseUrl}/orders/${orderId}/resend-confirmation`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async function clearNotificationQueue() {
    try {
      const notificationQueue = await getNotificationQueue();
      await notificationQueue.drain(true);
      const jobs = await notificationQueue.getJobs(["waiting", "delayed", "prioritized", "active", "completed", "failed"], 0, 200);
      if (jobs.length > 0) {
        await Promise.all(jobs.map((job) => job.remove().catch(() => undefined)));
      }
    } catch {}
  }

  async function seedScenario() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organizer = await prisma.organizer.create({
      data: { name: `Resend Org ${suffix}`, slug: `resend-org-${suffix}`, serviceFeeBps: 0, taxBps: 0 }
    });
    const otherOrganizer = await prisma.organizer.create({
      data: { name: `Other Resend Org ${suffix}`, slug: `other-resend-org-${suffix}`, serviceFeeBps: 0, taxBps: 0 }
    });
    created.organizerIds.push(organizer.id, otherOrganizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Resend Event ${suffix}`,
        slug: `resend-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 100,
        visibility: "published"
      }
    });
    const otherEvent = await prisma.event.create({
      data: {
        organizerId: otherOrganizer.id,
        name: `Other Resend Event ${suffix}`,
        slug: `other-resend-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 100,
        visibility: "published"
      }
    });
    created.eventIds.push(event.id, otherEvent.id);

    const ticketType = await prisma.ticketType.create({
      data: { eventId: event.id, name: "General", priceCents: 2000, currency: "ARS", quota: 50, remaining: 44, maxPerOrder: 10 }
    });
    const otherTicketType = await prisma.ticketType.create({
      data: { eventId: otherEvent.id, name: "General Other", priceCents: 2000, currency: "ARS", quota: 50, remaining: 49, maxPerOrder: 10 }
    });
    created.ticketTypeIds.push(ticketType.id, otherTicketType.id);

    const owner = await createUser("owner", organizer.id);
    const admin = await createUser("admin", organizer.id);
    const staff = await createUser("staff", organizer.id);
    const scanner = await createUser("scanner", organizer.id);
    const otherStaff = await createUser("staff", otherOrganizer.id);

    async function createOrder(
      status: "pending" | "failed" | "expired" | "paid_no_stock" | "paid",
      opts?: {
        tickets?: number;
        email?: string;
        sentAt?: Date | null;
        withReservation?: boolean;
        withPayment?: boolean;
        withLateCase?: boolean;
        organizerId?: string;
        eventId?: string;
        ticketTypeId?: string;
      }
    ) {
      const organizerId = opts?.organizerId ?? organizer.id;
      const eventId = opts?.eventId ?? event.id;
      const ticketTypeId = opts?.ticketTypeId ?? ticketType.id;

      const order = await prisma.order.create({
        data: {
          organizerId,
          eventId,
          userId: owner.user.id,
          customerEmail: opts?.email ?? `buyer-${status}-${suffix}@example.test`,
          status,
          orderNumber: `RESEND-${status}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
          subtotalCents: 2000,
          totalCents: 2000,
          feeCents: 0,
          taxCents: 0,
          confirmationEmailSentAt: opts?.sentAt === undefined ? null : opts.sentAt,
          items: { create: [{ ticketTypeId, quantity: 1, unitPriceCents: 2000, totalCents: 2000 }] }
        }
      });
      created.orderIds.push(order.id);

      const tickets = [] as string[];
      const ticketCount = opts?.tickets ?? 0;
      for (let index = 0; index < ticketCount; index += 1) {
        const { generateTicketCode } = await import("../../lib/qr.js");
        const ticket = await prisma.ticket.create({
          data: {
            orderId: order.id,
            ticketTypeId,
            eventId,
            status: "issued",
            code: generateTicketCode(`resend-${suffix}-${status}-${index}-${Math.random().toString(36).slice(2, 6)}`),
            qrPayload: `qr-${suffix}-${status}-${index}`
          }
        });
        created.ticketIds.push(ticket.id);
        tickets.push(ticket.id);
      }

      if (opts?.withReservation) {
        const reservation = await prisma.inventoryReservation.create({
          data: {
            orderId: order.id,
            ticketTypeId,
            quantity: 1,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000)
          }
        });
        created.reservationIds.push(reservation.id);
      }

      if (opts?.withPayment) {
        const payment = await prisma.payment.create({
          data: {
            orderId: order.id,
            provider: `mock-${status}-${suffix}`,
            providerRef: `provider-secret-${status}-${suffix}-${order.id}`,
            status: status === "paid" ? "paid" : "pending",
            amountCents: 2000
          }
        });
        created.paymentIds.push(payment.id);

        if (opts?.withLateCase) {
          const lateCase = await prisma.latePaymentCase.create({
            data: {
              orderId: order.id,
              provider: `late-${status}-${suffix}`,
              providerPaymentId: `late-payment-${status}-${suffix}`,
              paymentAttemptId: payment.id,
              inventoryReleased: true,
              status: "PENDING",
              version: 1
            }
          });
          created.lateCaseIds.push(lateCase.id);
        }
      }

      return { order, tickets };
    }

    const paidEligible = await createOrder("paid", { tickets: 1, withReservation: true, withPayment: true, withLateCase: true });
    const paidAlreadySent = await createOrder("paid", { tickets: 1, sentAt: new Date(), withPayment: true });
    const paidNoTickets = await createOrder("paid", { tickets: 0, withPayment: true });
    const paidBadEmail = await createOrder("paid", { tickets: 1, email: "not-an-email", withPayment: true });
    const pendingOrder = await createOrder("pending", { tickets: 1, withPayment: true });
    const failedOrder = await createOrder("failed", { tickets: 1, withPayment: true });
    const expiredOrder = await createOrder("expired", { tickets: 1, withPayment: true });
    const noStockOrder = await createOrder("paid_no_stock", { tickets: 1, withPayment: true });
    const crossOrganizerOrder = await createOrder("paid", {
      tickets: 1,
      withPayment: true,
      organizerId: otherOrganizer.id,
      eventId: otherEvent.id,
      ticketTypeId: otherTicketType.id
    });

    return { organizer, otherOrganizer, event, owner, admin, staff, scanner, otherStaff, paidEligible, paidAlreadySent, paidNoTickets, paidBadEmail, pendingOrder, failedOrder, expiredOrder, noStockOrder, crossOrganizerOrder };
  }

  it("enforces resend contract, eligibility, audit, minimization and queue semantics", async () => {
    await clearNotificationQueue();
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const otherStaffToken = await login(scenario.otherStaff.email, scenario.otherStaff.password);

    const validBody = {
      organizerId: scenario.organizer.id,
      reason: "reenvio manual por reclamo operativo"
    };

    const scannerResponse = await resend(scannerToken, scenario.paidEligible.order.id, validBody);
    expect(scannerResponse.status).toBe(403);

    const staffResponse = await resend(staffToken, scenario.paidEligible.order.id, validBody);
    expect(staffResponse.status).toBe(403);

    const otherStaffResponse = await resend(otherStaffToken, scenario.paidEligible.order.id, validBody);
    expect(otherStaffResponse.status).toBe(403);

    const withoutReason = await resend(adminToken, scenario.paidEligible.order.id, { organizerId: scenario.organizer.id });
    expect(withoutReason.status).toBe(400);

    const blankReason = await resend(adminToken, scenario.paidEligible.order.id, { organizerId: scenario.organizer.id, reason: "    " });
    expect(blankReason.status).toBe(400);

    const withoutOrganizer = await resend(adminToken, scenario.paidEligible.order.id, { reason: "motivo operativo suficientemente largo" });
    expect(withoutOrganizer.status).toBe(400);

    const missingOrder = await resend(adminToken, `00000000-0000-0000-0000-000000000000`, validBody);
    expect(missingOrder.status).toBe(404);

    const wrongScope = await resend(adminToken, scenario.paidEligible.order.id, {
      organizerId: scenario.otherOrganizer.id,
      reason: "admin intenta scope de otro organizer"
    });
    expect(wrongScope.status).toBe(403);

    const crossOrganizerOrder = await resend(adminToken, scenario.crossOrganizerOrder.order.id, {
      organizerId: scenario.organizer.id,
      reason: "admin intenta orden de otro organizer"
    });
    expect(crossOrganizerOrder.status).toBe(404);

    for (const candidate of [scenario.pendingOrder, scenario.failedOrder, scenario.expiredOrder, scenario.noStockOrder]) {
      const response = await resend(adminToken, candidate.order.id, validBody);
      expect(response.status).toBe(409);
    }

    const paidNoTickets = await resend(adminToken, scenario.paidNoTickets.order.id, validBody);
    expect(paidNoTickets.status).toBe(409);

    const paidBadEmail = await resend(adminToken, scenario.paidBadEmail.order.id, validBody);
    expect(paidBadEmail.status).toBe(409);

    const reservationBefore = await prisma.inventoryReservation.findMany({ where: { orderId: scenario.paidEligible.order.id }, orderBy: { createdAt: "asc" } });
    const paymentBefore = await prisma.payment.findMany({ where: { orderId: scenario.paidEligible.order.id }, orderBy: { createdAt: "asc" } });
    const lateCaseBefore = await prisma.latePaymentCase.findMany({ where: { orderId: scenario.paidEligible.order.id }, orderBy: { createdAt: "asc" } });
    const ticketCountBefore = await prisma.ticket.count({ where: { orderId: scenario.paidEligible.order.id } });

    const ownerReason = "owner solicita reenvio por soporte externo";
    const adminReason = "admin reenvia comprobante ya enviado antes";

    const ownerEligible = await resend(ownerToken, scenario.paidEligible.order.id, { ...validBody, reason: ownerReason });
    expect(ownerEligible.status).toBe(200);
    const ownerBody = await ownerEligible.json() as any;
    expect(ownerBody).toMatchObject({
      orderId: scenario.paidEligible.order.id,
      status: "queued",
      auditId: expect.any(String),
      emailMasked: expect.stringContaining("@")
    });

    const adminEligible = await resend(adminToken, scenario.paidAlreadySent.order.id, { ...validBody, reason: adminReason });
    expect(adminEligible.status).toBe(200);
    const adminBody = await adminEligible.json() as any;
    expect(adminBody).toMatchObject({
      orderId: scenario.paidAlreadySent.order.id,
      status: "queued",
      auditId: expect.any(String),
      emailMasked: expect.stringContaining("@")
    });

    const serialized = JSON.stringify({ ownerBody, adminBody });
    expect(serialized).not.toContain("provider-secret-");
    expect(serialized).not.toContain("qr-");
    expect(serialized).not.toContain("secret-ticket-code");
    expect(serialized).not.toContain("buyer-");

    const reservationAfter = await prisma.inventoryReservation.findMany({ where: { orderId: scenario.paidEligible.order.id }, orderBy: { createdAt: "asc" } });
    const paymentAfter = await prisma.payment.findMany({ where: { orderId: scenario.paidEligible.order.id }, orderBy: { createdAt: "asc" } });
    const lateCaseAfter = await prisma.latePaymentCase.findMany({ where: { orderId: scenario.paidEligible.order.id }, orderBy: { createdAt: "asc" } });
    const ticketCountAfter = await prisma.ticket.count({ where: { orderId: scenario.paidEligible.order.id } });

    expect(ticketCountAfter).toBe(ticketCountBefore);
    expect(JSON.stringify(reservationAfter)).toBe(JSON.stringify(reservationBefore));
    expect(JSON.stringify(paymentAfter)).toBe(JSON.stringify(paymentBefore));
    expect(JSON.stringify(lateCaseAfter)).toBe(JSON.stringify(lateCaseBefore));

    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: "order_confirmation_resend_requested",
        entityId: { in: [scenario.paidEligible.order.id, scenario.paidAlreadySent.order.id] }
      },
      orderBy: [{ entityId: "asc" }, { createdAt: "desc" }]
    });
    expect(auditRows).toHaveLength(2);
    created.auditLogIds.push(...auditRows.map((row) => row.id));

    const ownerAudit = auditRows.find((row) => row.entityId === scenario.paidEligible.order.id);
    const adminAudit = auditRows.find((row) => row.entityId === scenario.paidAlreadySent.order.id);

    expect(ownerAudit?.metadata).toMatchObject({
      reason: ownerReason,
      emailMasked: ownerBody.emailMasked,
      correlationId: expect.any(String),
      queueJobId: expect.stringContaining("order_confirmation_resend:")
    });
    expect(adminAudit?.metadata).toMatchObject({
      reason: adminReason,
      emailMasked: adminBody.emailMasked,
      correlationId: expect.any(String),
      queueJobId: expect.stringContaining("order_confirmation_resend:")
    });

    const serializedAudit = JSON.stringify([ownerAudit?.metadata ?? {}, adminAudit?.metadata ?? {}]);
    expect(serializedAudit).not.toContain("buyer-");
    expect(serializedAudit).not.toContain("provider-secret-");
    expect(serializedAudit).not.toContain("qr-");
    expect(serializedAudit).not.toContain("secret-ticket-code");

    const notificationQueue = await getNotificationQueue();
    for (const expected of [
      {
        audit: ownerAudit,
        orderId: scenario.paidEligible.order.id,
        actorUserId: scenario.owner.user.id
      },
      {
        audit: adminAudit,
        orderId: scenario.paidAlreadySent.order.id,
        actorUserId: scenario.admin.user.id
      }
    ]) {
      const queueJobId = String((expected.audit?.metadata as any)?.queueJobId ?? "");
      expect(queueJobId).toContain("order_confirmation_resend:");

      const job = queueJobId ? await notificationQueue.getJob(queueJobId) : null;
      if (job) {
        expect(job.name).toBe("order_confirmation_resend");
        expect(job.data).toMatchObject({
          type: "order_confirmation_resend",
          orderId: expected.orderId,
          meta: { actorUserId: expected.actorUserId }
        });
      }
    }
  });
});
