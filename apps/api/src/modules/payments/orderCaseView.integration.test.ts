import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "./integrationTestEnv.js";
import type { OrganizerRole } from "@articket/shared";

if (!process.env.API_PORT) process.env.API_PORT = "3426";
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

describe.skipIf(!hasIntegrationEnv)("order case view backend contract", () => {
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

  async function authFetch(path: string, token: string) {
    return fetch(`${baseUrl}${path}`, {
      headers: { authorization: `Bearer ${token}` }
    });
  }

  async function seedCaseViewScenario() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const organizer = await prisma.organizer.create({
      data: { name: `Case Org ${suffix}`, slug: `case-org-${suffix}`, serviceFeeBps: 0, taxBps: 0 }
    });
    const otherOrganizer = await prisma.organizer.create({
      data: { name: `Other Case Org ${suffix}`, slug: `other-case-org-${suffix}`, serviceFeeBps: 0, taxBps: 0 }
    });
    created.organizerIds.push(organizer.id, otherOrganizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Case Event ${suffix}`,
        slug: `case-event-${suffix}`,
        venue: "Auditorio Test",
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
        priceCents: 2000,
        currency: "ARS",
        quota: 10,
        remaining: 9,
        maxPerOrder: 10
      }
    });
    created.ticketTypeIds.push(ticketType.id);

    const staff = await createUser("staff", organizer.id);
    const scanner = await createUser("scanner", organizer.id);
    const otherStaff = await createUser("staff", otherOrganizer.id);

    const order = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        customerEmail: `caseview-secret-${suffix}@buyer.test`,
        status: "paid_no_stock",
        orderNumber: `CASE-${suffix}`,
        subtotalCents: 4000,
        totalCents: 4000,
        feeCents: 0,
        taxCents: 0,
        reservedUntil: new Date(Date.now() - 60_000),
        latePaymentReviewRequired: false,
        items: {
          create: [{ ticketTypeId: ticketType.id, quantity: 2, unitPriceCents: 2000, totalCents: 4000 }]
        },
        reservations: {
          create: [{ ticketTypeId: ticketType.id, quantity: 2, expiresAt: new Date(Date.now() - 60_000), releasedAt: new Date(), releaseReason: "expired_payment_compensation" }]
        }
      },
      include: { reservations: true }
    });
    created.orderIds.push(order.id);

    const ticket = await prisma.ticket.create({
      data: {
        orderId: order.id,
        ticketTypeId: ticketType.id,
        eventId: event.id,
        status: "issued",
        code: `secret-ticket-code-${suffix}`,
        qrPayload: `secret-qr-${suffix}`
      }
    });
    created.ticketIds.push(ticket.id);

    const payment = await prisma.payment.create({
      data: { orderId: order.id, provider: "mock", providerRef: `provider-secret-${suffix}`, status: "paid", amountCents: 4000 }
    });
    created.paymentIds.push(payment.id);

    const paymentEvent = await prisma.paymentEvent.create({
      data: {
        provider: "mock",
        providerEventId: `evt-secret-${suffix}`,
        providerPaymentId: payment.providerRef,
        eventType: "payment.succeeded",
        orderId: order.id,
        payloadJson: { rawSecret: "must-not-leak", buyer: order.customerEmail },
        processedAt: new Date()
      }
    });
    created.paymentEventIds.push(paymentEvent.id);

    const lateCase = await prisma.latePaymentCase.create({
      data: {
        orderId: order.id,
        reserveId: order.reservations[0].id,
        provider: "mock",
        providerPaymentId: payment.providerRef,
        paymentAttemptId: payment.id,
        inventoryReleased: true,
        status: "ACCEPTED",
        resolutionNotes: "operador aceptó conciliación manual",
        resolvedAt: new Date(),
        resolvedBy: staff.user.id,
        version: 1
      }
    });
    created.lateCaseIds.push(lateCase.id);

    await prisma.domainEvent.createMany({
      data: [
        {
          type: "PAYMENT_MARKED_NO_STOCK",
          actorType: "webhook",
          aggregateType: "order",
          aggregateId: order.id,
          organizerId: organizer.id,
          eventId: event.id,
          orderId: order.id,
          context: { source: "webhooks.payments" },
          payload: { rawSecret: "must-not-leak" }
        },
        {
          type: "LATE_PAYMENT_CASE_RESOLVED",
          actorType: "user",
          actorId: staff.user.id,
          aggregateType: "order",
          aggregateId: order.id,
          organizerId: organizer.id,
          eventId: event.id,
          orderId: order.id,
          context: { source: "late-payment-cases.resolve" },
          payload: { resolutionNotes: "operador aceptó conciliación manual", rawSecret: "must-not-leak" }
        }
      ]
    });

    const audit = await prisma.auditLog.create({
      data: {
        organizerId: organizer.id,
        actorUserId: staff.user.id,
        action: "late_payment_case.resolve",
        entityType: "LatePaymentCase",
        entityId: lateCase.id,
        metadata: {
          orderId: order.id,
          previous: { status: "PENDING", rawSecret: "must-not-leak" },
          next: { status: "ACCEPTED", resolutionNotes: "operador aceptó conciliación manual", rawSecret: "must-not-leak" }
        }
      }
    });
    created.auditLogIds.push(audit.id);

    return { organizer, event, ticketType, staff, scanner, otherStaff, order, ticket, payment, paymentEvent, lateCase, audit };
  }

  it("enforces viewOrderCase scope and returns minimized separated case view", async () => {
    const scenario = await seedCaseViewScenario();
    const staffToken = await login(scenario.staff.email, scenario.staff.password);
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const otherStaffToken = await login(scenario.otherStaff.email, scenario.otherStaff.password);

    const scannerResponse = await authFetch(`/orders/${scenario.order.id}/case-view`, scannerToken);
    expect(scannerResponse.status).toBe(403);

    const wrongScopeResponse = await authFetch(`/orders/${scenario.order.id}/case-view`, otherStaffToken);
    expect(wrongScopeResponse.status).toBe(403);

    const response = await authFetch(`/orders/${scenario.order.id}/case-view`, staffToken);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    const serialized = JSON.stringify(body);

    expect(body.orderSummary).toMatchObject({
      id: scenario.order.id,
      status: "paid_no_stock",
      totalCents: 4000,
      currency: "ARS",
      eventId: scenario.event.id,
      organizerId: scenario.organizer.id
    });
    expect(body.eventSummary).toMatchObject({ eventId: scenario.event.id, name: scenario.event.name, venue: "Auditorio Test" });
    expect(body.buyerSummary.emailMasked).toContain("@buyer.test");
    expect(body.buyerSummary.emailMasked).not.toBe(scenario.order.customerEmail);
    expect(body.itemSummary[0]).toMatchObject({ ticketTypeId: scenario.ticketType.id, ticketTypeName: "General", quantity: 2, unitPriceCents: 2000, subtotalCents: 4000 });
    expect(body.paymentSummary.payments[0]).toMatchObject({ provider: "mock", status: "paid", amountCents: 4000 });
    expect(body.paymentSummary.payments[0].providerRefMasked).not.toBe(scenario.payment.providerRef);
    expect(body.paymentSummary.events[0]).toMatchObject({ provider: "mock", eventType: "payment.succeeded", hasProcessError: false });
    expect(body.ticketSummary).toMatchObject({ count: 1, statuses: { issued: 1 } });
    expect(body.ticketSummary.tickets[0]).toMatchObject({ id: scenario.ticket.id, status: "issued" });
    expect(body.reservationSummary.statuses).toMatchObject({ released: 1 });
    expect(body.reservationSummary.reservations[0]).toMatchObject({ releaseReason: "expired_payment_compensation" });
    expect(body.latePaymentCaseSummary[0]).toMatchObject({ id: scenario.lateCase.id, status: "ACCEPTED", resolutionNotes: "operador aceptó conciliación manual", resolvedBy: scenario.staff.user.id });
    expect(body.operationalTimeline.map((entry: any) => entry.type)).toContain("PAYMENT_MARKED_NO_STOCK");
    expect(body.auditSummary[0]).toMatchObject({ action: "late_payment_case.resolve", previousStatus: "PENDING", nextStatus: "ACCEPTED", resolutionNotes: "operador aceptó conciliación manual" });

    expect(serialized).not.toContain(scenario.order.customerEmail);
    expect(serialized).not.toContain(scenario.payment.providerRef);
    expect(serialized).not.toContain(scenario.ticket.code);
    expect(serialized).not.toContain(scenario.ticket.qrPayload);
    expect(serialized).not.toContain("rawSecret");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("payloadJson");
  });
});
