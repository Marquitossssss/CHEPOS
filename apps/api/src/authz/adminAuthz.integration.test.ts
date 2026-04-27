import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { generateTicketCode } from "../lib/qr.js";
import { hasIntegrationEnv } from "../modules/payments/integrationTestEnv.js";
import { getOrganizerRoleCapabilities, type OrganizerRole } from "@articket/shared";

process.env.API_PORT = process.env.API_PORT ?? "3000";
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

describe.skipIf(!hasIntegrationEnv)("admin authz phase 1 integration", () => {
  const created = {
    userIds: [] as string[],
    organizerIds: [] as string[],
    eventIds: [] as string[],
    ticketTypeIds: [] as string[],
    orderIds: [] as string[],
    ticketIds: [] as string[],
    lateCaseIds: [] as string[]
  };

  beforeAll(async () => {
    await import("../server.js");
    await waitForHealth();
  });

  afterAll(async () => {
    if (created.organizerIds.length === 0) return;

    await prisma.ticketScan.deleteMany({ where: { eventId: { in: created.eventIds } } });
    await prisma.domainEvent.deleteMany({ where: { organizerId: { in: created.organizerIds } } });
    await prisma.auditLog.deleteMany({ where: { organizerId: { in: created.organizerIds } } });
    await prisma.emailEvent.deleteMany({ where: { orderId: { in: created.orderIds } } });
    await prisma.latePaymentCase.deleteMany({ where: { id: { in: created.lateCaseIds } } });
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

  async function authFetch(path: string, token: string, init?: RequestInit) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      }
    });
  }

  async function seedScenario() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const organizer = await prisma.organizer.create({
      data: {
        name: `Authz Org ${suffix}`,
        slug: `authz-org-${suffix}`,
        serviceFeeBps: 500,
        taxBps: 2100
      }
    });
    created.organizerIds.push(organizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Authz Event ${suffix}`,
        slug: `authz-event-${suffix}`,
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
        remaining: 99,
        maxPerOrder: 10
      }
    });
    created.ticketTypeIds.push(ticketType.id);

    const owner = await createUser("owner", organizer.id);
    const admin = await createUser("admin", organizer.id);
    const staff = await createUser("staff", organizer.id);
    const scanner = await createUser("scanner", organizer.id);

    const ownerOrder = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        userId: owner.user.id,
        customerEmail: owner.email,
        status: "paid",
        orderNumber: `AUTHZ-${suffix}`,
        subtotalCents: 1500,
        totalCents: 1500,
        feeCents: 0,
        taxCents: 0,
        confirmationEmailSentAt: new Date(),
        items: {
          create: [{
            ticketTypeId: ticketType.id,
            quantity: 1,
            unitPriceCents: 1500,
            totalCents: 1500
          }]
        }
      }
    });
    created.orderIds.push(ownerOrder.id);

    const ticket = await prisma.ticket.create({
      data: {
        orderId: ownerOrder.id,
        ticketTypeId: ticketType.id,
        eventId: event.id,
        status: "issued",
        code: generateTicketCode(`authz-${suffix}`),
        qrPayload: `authz-qr-${suffix}`
      }
    });
    created.ticketIds.push(ticket.id);

    const lateCase = await prisma.latePaymentCase.create({
      data: {
        orderId: ownerOrder.id,
        provider: `mock-${suffix}`,
        providerPaymentId: `payment-${suffix}`,
        status: "PENDING"
      }
    });
    created.lateCaseIds.push(lateCase.id);

    return { organizer, event, ticketType, owner, admin, staff, scanner, ownerOrder, ticket, lateCase };
  }

  it("maps capabilities coherently for owner/admin/staff/scanner", () => {
    expect(getOrganizerRoleCapabilities("owner")).toMatchObject({
      viewOrganizerSettings: true,
      updateOrganizerSettings: true,
      viewOrganizerMembers: true,
      inviteOrganizerMembers: true,
      manageOrganizerMemberships: true,
      revokeOrganizerInvitations: true,
      createEvent: true,
      manageTicketTypes: true,
      resolveLatePayments: true,
      viewOrderCase: true,
      sensitiveOrderLookup: true,
      viewEventActivity: true,
      scanTickets: true
    });

    expect(getOrganizerRoleCapabilities("admin")).toMatchObject({
      viewOrganizerSettings: true,
      updateOrganizerSettings: false,
      viewOrganizerMembers: true,
      inviteOrganizerMembers: false,
      manageOrganizerMemberships: false,
      revokeOrganizerInvitations: false,
      createEvent: true,
      manageTicketTypes: true,
      resolveLatePayments: true,
      viewOrderCase: true,
      sensitiveOrderLookup: true,
      viewEventActivity: true,
      scanTickets: true
    });

    expect(getOrganizerRoleCapabilities("staff")).toMatchObject({
      viewOrganizerSettings: false,
      updateOrganizerSettings: false,
      viewOrganizerMembers: false,
      inviteOrganizerMembers: false,
      manageOrganizerMemberships: false,
      revokeOrganizerInvitations: false,
      createEvent: false,
      manageTicketTypes: false,
      resolveLatePayments: false,
      viewLatePaymentCases: true,
      viewOrderCase: true,
      sensitiveOrderLookup: false,
      resendOrderConfirmation: true,
      viewEventDashboard: true,
      viewEventActivity: true,
      scanTickets: true
    });

    expect(getOrganizerRoleCapabilities("scanner")).toMatchObject({
      viewOrganizerSettings: false,
      updateOrganizerSettings: false,
      viewOrganizerMembers: false,
      inviteOrganizerMembers: false,
      manageOrganizerMemberships: false,
      revokeOrganizerInvitations: false,
      createEvent: false,
      manageTicketTypes: false,
      resolveLatePayments: false,
      viewLatePaymentCases: false,
      viewOrderCase: false,
      sensitiveOrderLookup: false,
      resendOrderConfirmation: false,
      viewEventActivity: false,
      scanTickets: true
    });
  });

  it("/authz/context returns capabilities coherent with membership", async () => {
    const scenario = await seedScenario();
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);

    const scannerContext = await authFetch(`/authz/context?organizerId=${scenario.organizer.id}&eventId=${scenario.event.id}`, scannerToken);
    expect(scannerContext.status).toBe(200);
    const scannerContextJson = await scannerContext.json() as any;
    expect(scannerContextJson.organizerRole).toBe("scanner");
    expect(scannerContextJson.scope).toBe("event");
    expect(scannerContextJson.capabilities.scanTickets).toBe(true);
    expect(scannerContextJson.capabilities.viewEventActivity).toBe(false);
    expect(scannerContextJson.capabilities.createEvent).toBe(false);

    const staffContext = await authFetch(`/authz/context?organizerId=${scenario.organizer.id}&eventId=${scenario.event.id}`, staffToken);
    expect(staffContext.status).toBe(200);
    const staffContextJson = await staffContext.json() as any;
    expect(staffContextJson.organizerRole).toBe("staff");
    expect(staffContextJson.capabilities.viewEventDashboard).toBe(true);
    expect(staffContextJson.capabilities.viewLatePaymentCases).toBe(true);
    expect(staffContextJson.capabilities.resolveLatePayments).toBe(false);
    expect(staffContextJson.capabilities.viewOrderCase).toBe(true);
    expect(staffContextJson.capabilities.sensitiveOrderLookup).toBe(false);
    expect(staffContextJson.capabilities.resendOrderConfirmation).toBe(true);
  });

  it("/authz/context rejects eventId that does not belong to organizerId", async () => {
    const scenarioA = await seedScenario();
    const scenarioB = await seedScenario();
    const ownerToken = await login(scenarioA.owner.email, scenarioA.owner.password);

    const response = await authFetch(
      `/authz/context?organizerId=${scenarioA.organizer.id}&eventId=${scenarioB.event.id}`,
      ownerToken
    );

    expect(response.status).toBe(400);
    const body = await response.json() as any;
    expect(body.detail).toBe("eventId no pertenece al organizerId indicado");
  });

  it("enforces viewEventActivity: scanner forbidden, staff allowed", async () => {
    const scenario = await seedScenario();
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);

    const scannerActivity = await authFetch(`/events/${scenario.event.id}/activity`, scannerToken);
    expect(scannerActivity.status).toBe(403);

    const staffActivity = await authFetch(`/events/${scenario.event.id}/activity`, staffToken);
    expect(staffActivity.status).toBe(200);
  });

  it("enforces scanTickets: scanner allowed on check-in", async () => {
    const scenario = await seedScenario();
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);

    const scannerCheckin = await authFetch(`/checkin/scan`, scannerToken, {
      method: "POST",
      body: JSON.stringify({ code: scenario.ticket.code })
    });
    expect(scannerCheckin.status).toBe(200);
    expect(await scannerCheckin.json()).toMatchObject({ ok: true });
  });

  it("enforces viewEventDashboard: staff allowed", async () => {
    const scenario = await seedScenario();
    const staffToken = await login(scenario.staff.email, scenario.staff.password);

    const staffDashboard = await authFetch(`/api/events/${scenario.event.id}/dashboard?range=7d&bucket=day`, staffToken);
    expect(staffDashboard.status).toBe(200);
  });

  it("enforces createEvent: staff denied, admin and owner allowed", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);

    const staffCreateEvent = await authFetch(`/events`, staffToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        name: `Denied Staff Event ${Date.now()}`,
        slug: `denied-staff-${Date.now()}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
        capacity: 50,
        visibility: "draft"
      })
    });
    expect(staffCreateEvent.status).toBe(403);

    const adminCreateEvent = await authFetch(`/events`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        name: `Admin Event ${Date.now()}`,
        slug: `admin-event-${Date.now()}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
        capacity: 50,
        visibility: "draft"
      })
    });
    expect(adminCreateEvent.status).toBe(200);
    const adminCreatedEvent = await adminCreateEvent.json() as any;
    created.eventIds.push(adminCreatedEvent.id);

    const ownerCreateEvent = await authFetch(`/events`, ownerToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        name: `Owner Event ${Date.now()}`,
        slug: `owner-event-${Date.now()}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 3600000).toISOString(),
        endsAt: new Date(Date.now() + 7200000).toISOString(),
        capacity: 50,
        visibility: "draft"
      })
    });
    expect(ownerCreateEvent.status).toBe(200);
    const ownerCreatedEvent = await ownerCreateEvent.json() as any;
    created.eventIds.push(ownerCreatedEvent.id);
  });

  it("enforces manageTicketTypes: staff denied, admin allowed", async () => {
    const scenario = await seedScenario();
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);

    const staffCreateTicketType = await authFetch(`/events/${scenario.event.id}/ticket-types`, staffToken, {
      method: "POST",
      body: JSON.stringify({
        name: "VIP staff denied",
        priceCents: 2500,
        currency: "ARS",
        quota: 20,
        maxPerOrder: 2
      })
    });
    expect(staffCreateTicketType.status).toBe(403);

    const adminCreateTicketType = await authFetch(`/events/${scenario.event.id}/ticket-types`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        name: `VIP ${Date.now()}`,
        priceCents: 2500,
        currency: "ARS",
        quota: 20,
        maxPerOrder: 2
      })
    });
    expect(adminCreateTicketType.status).toBe(200);
    const newTicketType = await adminCreateTicketType.json() as any;
    created.ticketTypeIds.push(newTicketType.id);
  });

  it("enforces late payment capabilities: staff can view but cannot resolve; admin and owner can resolve", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);

    const staffLateCases = await authFetch(`/late-payment-cases?organizerId=${scenario.organizer.id}`, staffToken);
    expect(staffLateCases.status).toBe(200);
    const staffLateCasesBody = await staffLateCases.json() as any[];
    expect(staffLateCasesBody[0]).toMatchObject({
      id: scenario.lateCase.id,
      orderId: scenario.ownerOrder.id,
      provider: scenario.lateCase.provider,
      providerPaymentId: scenario.lateCase.providerPaymentId,
      status: "PENDING",
      order: expect.objectContaining({
        id: scenario.ownerOrder.id,
        organizerId: scenario.organizer.id,
        eventId: scenario.event.id
      })
    });
    expect(staffLateCasesBody[0].order.customerEmail).toBeUndefined();

    const scannerLateCases = await authFetch(`/late-payment-cases?organizerId=${scenario.organizer.id}`, scannerToken);
    expect(scannerLateCases.status).toBe(403);

    const staffResolveLateCase = await authFetch(`/late-payment-cases/${scenario.lateCase.id}/resolve`, staffToken, {
      method: "POST",
      body: JSON.stringify({ action: "ACCEPT", resolutionNotes: "staff should fail" })
    });
    expect(staffResolveLateCase.status).toBe(403);

    const adminResolveWithoutReason = await authFetch(`/late-payment-cases/${scenario.lateCase.id}/resolve`, adminToken, {
      method: "POST",
      body: JSON.stringify({ action: "ACCEPT" })
    });
    expect(adminResolveWithoutReason.status).toBe(400);

    const adminResolveLateCase = await authFetch(`/late-payment-cases/${scenario.lateCase.id}/resolve`, adminToken, {
      method: "POST",
      body: JSON.stringify({ action: "ACCEPT", resolutionNotes: "admin ok" })
    });
    expect(adminResolveLateCase.status).toBe(200);
    const adminResolvedBody = await adminResolveLateCase.json() as any;
    expect(adminResolvedBody).toMatchObject({ status: "ACCEPTED", resolutionNotes: "admin ok", resolvedBy: scenario.admin.user.id });

    const duplicateResolve = await authFetch(`/late-payment-cases/${scenario.lateCase.id}/resolve`, adminToken, {
      method: "POST",
      body: JSON.stringify({ action: "REJECT", resolutionNotes: "second resolution should fail" })
    });
    expect(duplicateResolve.status).toBe(409);

    const [audit, resolvedEvents] = await Promise.all([
      prisma.auditLog.findFirst({ where: { entityType: "LatePaymentCase", entityId: scenario.lateCase.id, action: "late_payment_case.resolve" } }),
      prisma.domainEvent.count({ where: { orderId: scenario.ownerOrder.id, type: "LATE_PAYMENT_CASE_RESOLVED" } })
    ]);
    expect(audit).toBeTruthy();
    expect(audit?.metadata).toMatchObject({
      orderId: scenario.ownerOrder.id,
      previous: { status: "PENDING" },
      next: { status: "ACCEPTED", resolutionNotes: "admin ok", resolvedBy: scenario.admin.user.id }
    });
    expect(resolvedEvents).toBe(1);

    const secondLateCase = await prisma.latePaymentCase.create({
      data: {
        orderId: scenario.ownerOrder.id,
        provider: `mock-owner-${Date.now()}`,
        providerPaymentId: `payment-owner-${Date.now()}`,
        status: "PENDING"
      }
    });
    created.lateCaseIds.push(secondLateCase.id);

    const ownerResolveLateCase = await authFetch(`/late-payment-cases/${secondLateCase.id}/resolve`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ action: "ACCEPT", resolutionNotes: "owner ok" })
    });
    expect(ownerResolveLateCase.status).toBe(200);
  });

  it("enforces resend confirmation: scanner denied, staff allowed", async () => {
    const scenario = await seedScenario();
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);

    const scannerResend = await authFetch(`/orders/${scenario.ownerOrder.id}/resend-confirmation`, scannerToken, {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(scannerResend.status).toBe(403);

    const staffResend = await authFetch(`/orders/${scenario.ownerOrder.id}/resend-confirmation`, staffToken, {
      method: "POST",
      body: JSON.stringify({})
    });
    expect(staffResend.status).toBe(200);
  });
});
