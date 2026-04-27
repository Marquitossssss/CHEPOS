import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "./integrationTestEnv.js";
import type { OrganizerRole } from "@articket/shared";

if (!process.env.API_PORT) process.env.API_PORT = "3428";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
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

describe.skipIf(!hasIntegrationEnv)("sensitive order lookup contract", () => {
  const created = {
    userIds: [] as string[],
    organizerIds: [] as string[],
    eventIds: [] as string[],
    ticketTypeIds: [] as string[],
    orderIds: [] as string[],
    ticketIds: [] as string[],
    paymentIds: [] as string[],
    paymentEventIds: [] as string[],
    lateCaseIds: [] as string[],
    auditLogIds: [] as string[]
  };

  beforeAll(async () => {
    await import("../../server.js");
    await waitForHealth();
  });

  afterAll(async () => {
    const lookupAudits = await prisma.auditLog.findMany({
      where: { organizerId: { in: created.organizerIds }, action: "sensitive_order_lookup" },
      select: { id: true }
    });
    created.auditLogIds.push(...lookupAudits.map((audit) => audit.id));

    if (created.orderIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { id: { in: created.auditLogIds } } });
      await prisma.domainEvent.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.latePaymentCase.deleteMany({ where: { id: { in: created.lateCaseIds } } });
      await prisma.paymentEvent.deleteMany({ where: { id: { in: created.paymentEventIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: created.paymentIds } } });
      await prisma.ticketScan.deleteMany({ where: { eventId: { in: created.eventIds } } });
      await prisma.ticket.deleteMany({ where: { id: { in: created.ticketIds } } });
      await prisma.inventoryReservation.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: created.orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
    }
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

  async function lookup(token: string, body: Record<string, unknown>) {
    return fetch(`${baseUrl}/orders/sensitive-lookup`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async function seedScenario() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organizer = await prisma.organizer.create({
      data: { name: `Lookup Org ${suffix}`, slug: `lookup-org-${suffix}`, serviceFeeBps: 0, taxBps: 0 }
    });
    const otherOrganizer = await prisma.organizer.create({
      data: { name: `Other Lookup Org ${suffix}`, slug: `other-lookup-org-${suffix}`, serviceFeeBps: 0, taxBps: 0 }
    });
    created.organizerIds.push(organizer.id, otherOrganizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Lookup Event ${suffix}`,
        slug: `lookup-event-${suffix}`,
        venue: "Auditorio Test",
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
        name: `Other Lookup Event ${suffix}`,
        slug: `other-lookup-event-${suffix}`,
        venue: "Auditorio Other",
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 100,
        visibility: "published"
      }
    });
    created.eventIds.push(event.id, otherEvent.id);

    const ticketType = await prisma.ticketType.create({
      data: { eventId: event.id, name: "General", priceCents: 2000, currency: "ARS", quota: 30, remaining: 18, maxPerOrder: 10 }
    });
    created.ticketTypeIds.push(ticketType.id);

    const admin = await createUser("admin", organizer.id);
    const staff = await createUser("staff", organizer.id);
    const scanner = await createUser("scanner", organizer.id);
    const otherStaff = await createUser("staff", otherOrganizer.id);

    const customerEmail = `lookup-secret-${suffix}@buyer.test`;
    const providerRef = `provider-secret-${suffix}`;
    const ticketCode = `secret-ticket-code-${suffix}`;
    const qrPayload = `secret-qr-${suffix}`;

    const orders = [] as { id: string }[];
    for (let index = 0; index < 12; index += 1) {
      const order = await prisma.order.create({
        data: {
          organizerId: organizer.id,
          eventId: event.id,
          customerEmail,
          status: index === 0 ? "paid_no_stock" : "paid",
          orderNumber: `LOOKUP-${suffix}-${index}`,
          subtotalCents: 2000,
          totalCents: 2000,
          feeCents: 0,
          taxCents: 0,
          reservedUntil: new Date(Date.now() - 60_000),
          latePaymentReviewRequired: index === 0,
          items: { create: [{ ticketTypeId: ticketType.id, quantity: 1, unitPriceCents: 2000, totalCents: 2000 }] }
        }
      });
      created.orderIds.push(order.id);
      orders.push(order);
    }

    const ticket = await prisma.ticket.create({
      data: { orderId: orders[0].id, ticketTypeId: ticketType.id, eventId: event.id, status: "issued", code: ticketCode, qrPayload }
    });
    created.ticketIds.push(ticket.id);

    const payment = await prisma.payment.create({
      data: { orderId: orders[0].id, provider: "mock", providerRef, status: "paid", amountCents: 2000 }
    });
    created.paymentIds.push(payment.id);

    const paymentEvent = await prisma.paymentEvent.create({
      data: {
        provider: "mock",
        providerEventId: `evt-secret-${suffix}`,
        providerPaymentId: providerRef,
        eventType: "payment.succeeded",
        orderId: orders[0].id,
        payloadJson: { rawSecret: "must-not-leak", buyer: customerEmail },
        processedAt: new Date()
      }
    });
    created.paymentEventIds.push(paymentEvent.id);

    const lateCase = await prisma.latePaymentCase.create({
      data: {
        orderId: orders[0].id,
        reserveId: null,
        provider: "mock",
        providerPaymentId: providerRef,
        paymentAttemptId: payment.id,
        inventoryReleased: true,
        status: "PENDING",
        version: 1
      }
    });
    created.lateCaseIds.push(lateCase.id);

    return { organizer, otherOrganizer, event, otherEvent, admin, staff, scanner, otherStaff, orders, customerEmail, providerRef, ticketCode, qrPayload };
  }

  it("enforces dedicated capability, scope, minimization, limits and audit", async () => {
    const scenario = await seedScenario();
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const otherStaffToken = await login(scenario.otherStaff.email, scenario.otherStaff.password);

    const validBody = {
      queryType: "email",
      query: `  ${scenario.customerEmail.toUpperCase()}  `,
      organizerId: scenario.organizer.id,
      eventId: scenario.event.id,
      reason: "investigar consulta sensible de soporte"
    };

    const scannerResponse = await lookup(scannerToken, validBody);
    expect(scannerResponse.status).toBe(403);

    const staffWithoutSensitiveLookup = await lookup(staffToken, validBody);
    expect(staffWithoutSensitiveLookup.status).toBe(403);

    const otherStaffWrongScope = await lookup(otherStaffToken, validBody);
    expect(otherStaffWrongScope.status).toBe(403);

    const wrongEventScope = await lookup(adminToken, { ...validBody, eventId: scenario.otherEvent.id });
    expect(wrongEventScope.status).toBe(403);

    const withoutReason = await lookup(adminToken, { ...validBody, reason: undefined });
    expect(withoutReason.status).toBe(400);

    const shortQuery = await lookup(adminToken, { ...validBody, query: "a@b.c" });
    expect(shortQuery.status).toBe(400);

    const unsupportedDni = await lookup(adminToken, { ...validBody, queryType: "dni", query: "12345678" });
    expect(unsupportedDni.status).toBe(400);

    const response = await lookup(adminToken, validBody);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    const serialized = JSON.stringify(body);

    expect(body.results).toHaveLength(10);
    expect(body.meta).toMatchObject({ limited: true });
    expect(body.results[0]).toMatchObject({
      eventId: scenario.event.id,
      eventTitle: scenario.event.name,
      caseViewAvailable: true,
      buyerDisplay: { name: null, documentMasked: null }
    });
    expect(body.results[0].orderId).toEqual(expect.any(String));
    expect(body.results[0].orderStatus).toEqual(expect.any(String));
    expect(body.results[0].createdAt).toEqual(expect.any(String));
    expect(body.results[0].buyerDisplay.emailMasked).toContain("@buyer.test");
    expect(body.results[0].buyerDisplay.emailMasked).not.toBe(scenario.customerEmail);

    expect(serialized).not.toContain(scenario.customerEmail);
    expect(serialized).not.toContain(scenario.providerRef);
    expect(serialized).not.toContain(scenario.ticketCode);
    expect(serialized).not.toContain(scenario.qrPayload);
    expect(serialized).not.toContain("rawSecret");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("payloadJson");

    const paymentReferenceResponse = await lookup(adminToken, {
      queryType: "paymentReference",
      query: scenario.providerRef,
      organizerId: scenario.organizer.id,
      reason: "localizar orden por referencia de pago"
    });
    expect(paymentReferenceResponse.status).toBe(200);
    const paymentReferenceBody = await paymentReferenceResponse.json() as any;
    const paymentReferenceSerialized = JSON.stringify(paymentReferenceBody);
    expect(paymentReferenceBody.results).toHaveLength(1);
    expect(paymentReferenceSerialized).not.toContain(scenario.providerRef);

    const outsideScope = await lookup(adminToken, {
      queryType: "email",
      query: scenario.customerEmail,
      organizerId: scenario.otherOrganizer.id,
      reason: "validar que no filtre existencia fuera de scope"
    });
    expect(outsideScope.status).toBe(403);

    const audit = await prisma.auditLog.findFirst({
      where: { organizerId: scenario.organizer.id, actorUserId: scenario.admin.user.id, action: "sensitive_order_lookup" },
      orderBy: { createdAt: "desc" }
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe("SensitiveOrderLookup");
    expect(audit?.entityId).toBe(scenario.organizer.id);
    const auditMetadata = audit?.metadata as any;
    expect(auditMetadata).toMatchObject({
      eventId: null,
      queryType: "paymentReference",
      reason: "localizar orden por referencia de pago",
      resultCount: 1,
      resultCountBucket: "1",
      limited: false
    });
    expect(auditMetadata.queryFingerprint).toEqual(expect.any(String));
    expect(auditMetadata.queryFingerprint).toHaveLength(64);
    expect(JSON.stringify(auditMetadata)).not.toContain(scenario.providerRef);
    expect(JSON.stringify(auditMetadata)).not.toContain(scenario.customerEmail);
  });
});
