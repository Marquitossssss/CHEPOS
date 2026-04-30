if (!process.env.API_PORT) process.env.API_PORT = "3435";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "../payments/integrationTestEnv.js";
import type { OrganizerRole } from "@articket/shared";

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

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableNormalize(nested)])
    );
  }
  return value;
}

function hashJson(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(stableNormalize(value))).digest("hex");
}

describe.skipIf(!hasIntegrationEnv)("venue layouts backend foundation", () => {
  const created = {
    userIds: [] as string[],
    organizerIds: [] as string[],
    eventIds: [] as string[],
    ticketTypeIds: [] as string[],
    orderIds: [] as string[],
    ticketIds: [] as string[],
    paymentIds: [] as string[],
    reservationIds: [] as string[],
    venueIds: [] as string[],
    templateIds: [] as string[],
    versionIds: [] as string[],
    snapshotIds: [] as string[],
    auditLogIds: [] as string[]
  };

  beforeAll(async () => {
    await import("../../server.js");
    await waitForHealth();
  });

  afterAll(async () => {
    if (created.organizerIds.length === 0) return;

    await prisma.auditLog.deleteMany({ where: { id: { in: created.auditLogIds } } });
    await prisma.eventLayoutSnapshot.deleteMany({ where: { id: { in: created.snapshotIds } } });
    await prisma.venueLayoutVersion.deleteMany({ where: { id: { in: created.versionIds } } });
    await prisma.venueLayoutTemplate.deleteMany({ where: { id: { in: created.templateIds } } });
    await prisma.venue.deleteMany({ where: { id: { in: created.venueIds } } });
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
      data: { name: `Venue Org ${suffix}`, slug: `venue-org-${suffix}`, serviceFeeBps: 500, taxBps: 2100 }
    });
    const otherOrganizer = await prisma.organizer.create({
      data: { name: `Other Venue Org ${suffix}`, slug: `other-venue-org-${suffix}`, serviceFeeBps: 500, taxBps: 2100 }
    });
    created.organizerIds.push(organizer.id, otherOrganizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Venue Event ${suffix}`,
        slug: `venue-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 500,
        visibility: "published",
        venue: "legacy-free-text"
      }
    });
    const otherEvent = await prisma.event.create({
      data: {
        organizerId: otherOrganizer.id,
        name: `Other Venue Event ${suffix}`,
        slug: `other-venue-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 400,
        visibility: "published",
        venue: "legacy-free-text-b"
      }
    });
    created.eventIds.push(event.id, otherEvent.id);

    const ticketType = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: `General ${suffix}`,
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
    const otherOwner = await createUser("owner", otherOrganizer.id);
    const otherStaff = await createUser("staff", otherOrganizer.id);

    const order = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        userId: owner.user.id,
        customerEmail: owner.email,
        status: "paid",
        orderNumber: `VENUE-LAYOUT-${suffix}`,
        subtotalCents: 1500,
        totalCents: 1500,
        feeCents: 0,
        taxCents: 0,
        items: { create: [{ ticketTypeId: ticketType.id, quantity: 1, unitPriceCents: 1500, totalCents: 1500 }] }
      }
    });
    created.orderIds.push(order.id);

    const ticket = await prisma.ticket.create({
      data: {
        orderId: order.id,
        ticketTypeId: ticketType.id,
        eventId: event.id,
        status: "issued",
        code: `t-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
        qrPayload: `qr-${suffix}`
      }
    });
    created.ticketIds.push(ticket.id);

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: `mock-${suffix}`,
        providerRef: `provider-${suffix}`,
        status: "paid",
        amountCents: 1500
      }
    });
    created.paymentIds.push(payment.id);

    const reservation = await prisma.inventoryReservation.create({
      data: {
        orderId: order.id,
        ticketTypeId: ticketType.id,
        quantity: 1,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });
    created.reservationIds.push(reservation.id);

    return { organizer, otherOrganizer, event, otherEvent, ticketType, owner, admin, staff, scanner, otherOwner, otherStaff, order, ticket, payment, reservation, suffix };
  }

  function buildLayoutData(suffix: string, mode: "seated" | "ga" | "mixed" = "seated") {
    const zones = mode === "ga"
      ? [{ id: `zone-ga-${suffix}`, name: `GA ${suffix}`, kind: "standing" as const, capacity: 500 }]
      : [{ id: `zone-main-${suffix}`, name: `Main ${suffix}`, kind: "seated" as const, capacity: 100 }];

    return {
      schemaVersion: "venue-layout.v1",
      canvas: { width: 1200, height: 800, unit: "px" as const },
      zones,
      seats: mode === "ga"
        ? []
        : [{
            id: `seat-secret-${suffix}`,
            label: `SECRET-SEAT-${suffix}`,
            zoneId: zones[0]!.id,
            row: "A",
            number: "1",
            x: 100,
            y: 120,
            status: "active" as const
          }],
      accessPoints: [{ id: `gate-${suffix}`, name: `Gate ${suffix}`, kind: "gate" as const }],
      posAreas: [{ id: `pos-${suffix}`, name: `POS ${suffix}` }]
    };
  }

  it("enforces authz, venues, templates and versions with stable validation", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const otherOwnerToken = await login(scenario.otherOwner.email, scenario.otherOwner.password);

    const venueBody = {
      organizerId: scenario.organizer.id,
      name: `Gran Teatro ${scenario.suffix}`,
      venueType: "theater",
      location: { city: "Mar del Plata", address: "Independencia 1234" },
      reason: "crear venue backend con trazabilidad"
    };

    expect((await authFetch("/venues", scannerToken, { method: "POST", body: JSON.stringify(venueBody) })).status).toBe(403);
    expect((await authFetch("/venues", staffToken, { method: "POST", body: JSON.stringify(venueBody) })).status).toBe(403);

    const ownerVenue = await authFetch("/venues", ownerToken, { method: "POST", body: JSON.stringify(venueBody) });
    expect(ownerVenue.status).toBe(201);
    const ownerVenueJson = await ownerVenue.json() as any;
    created.venueIds.push(ownerVenueJson.id);

    const adminVenue = await authFetch("/venues", adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        name: `Arena Sur ${scenario.suffix}`,
        slug: `arena-sur-${scenario.suffix}`,
        venueType: "arena",
        reason: "crear segundo venue administrable"
      })
    });
    expect(adminVenue.status).toBe(201);
    const adminVenueJson = await adminVenue.json() as any;
    created.venueIds.push(adminVenueJson.id);

    expect((await authFetch("/venues", ownerToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, name: "Sin razon", venueType: "theater" })
    })).status).toBe(400);

    expect((await authFetch("/venues", ownerToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, name: "Venue invalido", venueType: "weird", reason: "venue type inválido real" })
    })).status).toBe(400);

    const venuesList = await authFetch(`/venues?organizerId=${scenario.organizer.id}`, staffToken);
    expect(venuesList.status).toBe(200);
    const venuesListJson = await venuesList.json() as any[];
    expect(venuesListJson.map((row) => row.id)).toContain(ownerVenueJson.id);

    const forbiddenList = await authFetch(`/venues?organizerId=${scenario.organizer.id}`, otherOwnerToken);
    expect(forbiddenList.status).toBe(403);

    const ownVenueDetail = await authFetch(`/venues/${ownerVenueJson.id}`, staffToken);
    expect(ownVenueDetail.status).toBe(200);

    const foreignVenueDetail = await authFetch(`/venues/${ownerVenueJson.id}`, otherOwnerToken);
    expect([403, 404]).toContain(foreignVenueDetail.status);

    expect((await authFetch(`/venues/${ownerVenueJson.id}/layout-templates`, staffToken, {
      method: "POST",
      body: JSON.stringify({ name: "Platea base", layoutMode: "seated", reason: "staff no debe poder mutar layouts" })
    })).status).toBe(403);

    const templateCreate = await authFetch(`/venues/${ownerVenueJson.id}/layout-templates`, adminToken, {
      method: "POST",
      body: JSON.stringify({ name: "Platea base", description: "template principal", layoutMode: "seated", reason: "crear template reutilizable inicial" })
    });
    expect(templateCreate.status).toBe(201);
    const templateJson = await templateCreate.json() as any;
    created.templateIds.push(templateJson.id);

    expect((await authFetch(`/venues/${ownerVenueJson.id}/layout-templates`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ name: "Modo invalido", layoutMode: "odd", reason: "layout mode inválido forzado" })
    })).status).toBe(400);

    expect((await authFetch(`/venues/00000000-0000-0000-0000-000000000000/layout-templates`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ name: "No existe", layoutMode: "seated", reason: "venue inexistente debe fallar" })
    })).status).toBe(404);

    expect((await authFetch(`/venues/${ownerVenueJson.id}/layout-templates`, otherOwnerToken, {
      method: "POST",
      body: JSON.stringify({ name: "Fuera scope", layoutMode: "seated", reason: "otro organizer no debe mutar venue ajeno" })
    })).status).toBe(403);

    const templatesList = await authFetch(`/venues/${ownerVenueJson.id}/layout-templates`, staffToken);
    expect(templatesList.status).toBe(200);
    expect((await templatesList.json() as any[]).map((row) => row.id)).toContain(templateJson.id);

    expect((await authFetch(`/layout-templates/${templateJson.id}/versions`, staffToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: buildLayoutData(`staff-${scenario.suffix}`), reason: "staff no puede crear versiones" })
    })).status).toBe(403);

    expect((await authFetch(`/layout-templates/${templateJson.id}/versions`, adminToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: { schemaVersion: "venue-layout.v1", canvas: { width: 100, height: 100, unit: "px" }, zones: [], seats: [], accessPoints: [], posAreas: [] }, reason: "seated sin seats activos debe fallar" })
    })).status).toBe(400);

    const brokenZone = buildLayoutData(`broken-zone-${scenario.suffix}`);
    brokenZone.seats[0]!.zoneId = "zone-missing";
    expect((await authFetch(`/layout-templates/${templateJson.id}/versions`, adminToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: brokenZone, reason: "seat zone inexistente debe fallar" })
    })).status).toBe(400);

    const duplicateIds = buildLayoutData(`dup-${scenario.suffix}`);
    duplicateIds.seats.push({ ...duplicateIds.seats[0]!, id: duplicateIds.seats[0]!.id, label: "DUP" });
    expect((await authFetch(`/layout-templates/${templateJson.id}/versions`, adminToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: duplicateIds, reason: "ids duplicados deben fallar" })
    })).status).toBe(400);

    const versionOneData = buildLayoutData(`v1-${scenario.suffix}`);
    const versionOne = await authFetch(`/layout-templates/${templateJson.id}/versions`, adminToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: versionOneData, reason: "publicar primera versión estable" })
    });
    expect(versionOne.status).toBe(201);
    const versionOneJson = await versionOne.json() as any;
    created.versionIds.push(versionOneJson.id);
    expect(versionOneJson.versionNumber).toBe(1);
    expect(versionOneJson.schemaVersion).toBe("venue-layout.v1");
    expect(versionOneJson.layoutHash).toBe(hashJson(versionOneData));
    expect(versionOneJson.publishedAt).toBeTruthy();

    const versionTwoData = buildLayoutData(`v2-${scenario.suffix}`);
    versionTwoData.seats[0]!.label = `SECRET-SEAT-V2-${scenario.suffix}`;
    const versionTwo = await authFetch(`/layout-templates/${templateJson.id}/versions`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: versionTwoData, reason: "crear nueva revisión publicada" })
    });
    expect(versionTwo.status).toBe(201);
    const versionTwoJson = await versionTwo.json() as any;
    created.versionIds.push(versionTwoJson.id);
    expect(versionTwoJson.versionNumber).toBe(2);

    expect((await authFetch(`/layout-templates/${templateJson.id}/versions`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ versionNumber: 2, schemaVersion: "venue-layout.v1", layoutData: buildLayoutData(`dup-vnum-${scenario.suffix}`), reason: "duplicado intencional de version number" })
    })).status).toBe(409);

    const versionsList = await authFetch(`/layout-templates/${templateJson.id}/versions`, staffToken);
    expect(versionsList.status).toBe(200);
    const versionsListJson = await versionsList.json() as any[];
    expect(versionsListJson[0]?.versionNumber).toBe(2);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: { in: ["venue_created", "venue_layout_template_created", "venue_layout_version_created"] },
        organizerId: scenario.organizer.id
      },
      orderBy: [{ createdAt: "asc" }]
    });
    created.auditLogIds.push(...auditRows.map((row) => row.id));
    expect(auditRows.some((row) => row.action === "venue_created" && jsonMetadata(row).reason)).toBe(true);
    expect(auditRows.some((row) => row.action === "venue_layout_template_created" && jsonMetadata(row).reason)).toBe(true);
    expect(auditRows.filter((row) => row.action === "venue_layout_version_created")).toHaveLength(2);
    const serializedAudit = JSON.stringify(auditRows.map((row) => row.metadata ?? {}));
    expect(serializedAudit).not.toContain(`SECRET-SEAT-v1-${scenario.suffix}`);
    expect(serializedAudit).not.toContain(`SECRET-SEAT-V2-${scenario.suffix}`);
    expect(serializedAudit).not.toContain(`zone-main-v1-${scenario.suffix}`);
  });

  it("creates immutable event snapshots with audit and no side effects", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const otherOwnerToken = await login(scenario.otherOwner.email, scenario.otherOwner.password);

    const venue = await authFetch("/venues", ownerToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        name: `Snapshot Venue ${scenario.suffix}`,
        venueType: "mixed",
        reason: "crear venue para snapshots de evento"
      })
    });
    expect(venue.status).toBe(201);
    const venueJson = await venue.json() as any;
    created.venueIds.push(venueJson.id);

    const template = await authFetch(`/venues/${venueJson.id}/layout-templates`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ name: `Template ${scenario.suffix}`, description: "snapshot template", layoutMode: "seated", reason: "crear template previo a snapshot" })
    });
    expect(template.status).toBe(201);
    const templateJson = await template.json() as any;
    created.templateIds.push(templateJson.id);

    const versionData = buildLayoutData(`snap-v1-${scenario.suffix}`);
    const version = await authFetch(`/layout-templates/${templateJson.id}/versions`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: versionData, reason: "crear versión fuente para snapshot" })
    });
    expect(version.status).toBe(201);
    const versionJson = await version.json() as any;
    created.versionIds.push(versionJson.id);

    const otherVenue = await authFetch("/venues", otherOwnerToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.otherOrganizer.id, name: `Other Venue ${scenario.suffix}`, venueType: "club", reason: "crear venue externo para aislamiento" })
    });
    expect(otherVenue.status).toBe(201);
    const otherVenueJson = await otherVenue.json() as any;
    created.venueIds.push(otherVenueJson.id);

    const otherTemplate = await authFetch(`/venues/${otherVenueJson.id}/layout-templates`, otherOwnerToken, {
      method: "POST",
      body: JSON.stringify({ name: `Other Template ${scenario.suffix}`, layoutMode: "ga", reason: "crear template de otro organizer" })
    });
    expect(otherTemplate.status).toBe(201);
    const otherTemplateJson = await otherTemplate.json() as any;
    created.templateIds.push(otherTemplateJson.id);

    const otherVersionData = buildLayoutData(`snap-other-${scenario.suffix}`, "ga");
    const otherVersion = await authFetch(`/layout-templates/${otherTemplateJson.id}/versions`, otherOwnerToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: otherVersionData, reason: "crear version externa publicada" })
    });
    expect(otherVersion.status).toBe(201);
    const otherVersionJson = await otherVersion.json() as any;
    created.versionIds.push(otherVersionJson.id);

    expect((await authFetch(`/events/${scenario.event.id}/layout-snapshot`, scannerToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, layoutVersionId: versionJson.id, reason: "scanner no puede crear snapshot" })
    })).status).toBe(403);

    expect((await authFetch(`/events/${scenario.event.id}/layout-snapshot`, staffToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, layoutVersionId: versionJson.id, reason: "staff no puede crear snapshot" })
    })).status).toBe(403);

    expect((await authFetch(`/events/00000000-0000-0000-0000-000000000000/layout-snapshot`, adminToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, layoutVersionId: versionJson.id, reason: "evento inexistente debe fallar limpio" })
    })).status).toBe(404);

    expect((await authFetch(`/events/${scenario.otherEvent.id}/layout-snapshot`, adminToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, layoutVersionId: versionJson.id, reason: "evento de otro organizer no debe filtrar" })
    })).status).toBe(404);

    expect((await authFetch(`/events/${scenario.event.id}/layout-snapshot`, adminToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, layoutVersionId: otherVersionJson.id, reason: "version de otro organizer no debe filtrar" })
    })).status).toBe(404);

    const countsBefore = {
      reservations: await prisma.inventoryReservation.count({ where: { orderId: scenario.order.id } }),
      payments: await prisma.payment.count({ where: { orderId: scenario.order.id } }),
      tickets: await prisma.ticket.count({ where: { orderId: scenario.order.id } }),
      orders: await prisma.order.count({ where: { id: scenario.order.id, organizerId: scenario.organizer.id } }),
      ticketType: await prisma.ticketType.findUnique({ where: { id: scenario.ticketType.id }, select: { priceCents: true, remaining: true } })
    };

    const snapshotCreate = await authFetch(`/events/${scenario.event.id}/layout-snapshot`, adminToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, layoutVersionId: versionJson.id, reason: "congelar layout para producción auditada" })
    });
    expect(snapshotCreate.status).toBe(201);
    const snapshotJson = await snapshotCreate.json() as any;
    created.snapshotIds.push(snapshotJson.id);
    expect(snapshotJson.eventId).toBe(scenario.event.id);
    expect(snapshotJson.layoutVersionId).toBe(versionJson.id);
    expect(hashJson(snapshotJson.snapshotData)).toBe(snapshotJson.snapshotHash);
    expect(stableNormalize(snapshotJson.snapshotData)).toEqual(stableNormalize(versionData));

    const snapshotGetAdmin = await authFetch(`/events/${scenario.event.id}/layout-snapshot`, adminToken);
    expect(snapshotGetAdmin.status).toBe(200);
    const snapshotGetAdminJson = await snapshotGetAdmin.json() as any;
    expect(stableNormalize(snapshotGetAdminJson.snapshotData)).toEqual(stableNormalize(versionData));

    const snapshotGetStaff = await authFetch(`/events/${scenario.event.id}/layout-snapshot`, staffToken);
    expect(snapshotGetStaff.status).toBe(200);

    const snapshotGetOther = await authFetch(`/events/${scenario.event.id}/layout-snapshot`, otherOwnerToken);
    expect(snapshotGetOther.status).toBe(403);

    const versionTwoData = buildLayoutData(`snap-v2-${scenario.suffix}`);
    versionTwoData.seats[0]!.label = `SECRET-AFTER-SNAPSHOT-${scenario.suffix}`;
    const versionTwo = await authFetch(`/layout-templates/${templateJson.id}/versions`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ schemaVersion: "venue-layout.v1", layoutData: versionTwoData, reason: "crear nueva version posterior al snapshot" })
    });
    expect(versionTwo.status).toBe(201);
    const versionTwoJson = await versionTwo.json() as any;
    created.versionIds.push(versionTwoJson.id);

    const snapshotGetAfterNewVersion = await authFetch(`/events/${scenario.event.id}/layout-snapshot`, adminToken);
    expect(snapshotGetAfterNewVersion.status).toBe(200);
    const snapshotGetAfterNewVersionJson = await snapshotGetAfterNewVersion.json() as any;
    expect(stableNormalize(snapshotGetAfterNewVersionJson.snapshotData)).toEqual(stableNormalize(versionData));
    expect(JSON.stringify(snapshotGetAfterNewVersionJson.snapshotData)).not.toContain(`SECRET-AFTER-SNAPSHOT-${scenario.suffix}`);

    expect((await authFetch(`/events/${scenario.event.id}/layout-snapshot`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ organizerId: scenario.organizer.id, layoutVersionId: versionTwoJson.id, reason: "segundo snapshot debe colisionar" })
    })).status).toBe(409);

    const countsAfter = {
      reservations: await prisma.inventoryReservation.count({ where: { orderId: scenario.order.id } }),
      payments: await prisma.payment.count({ where: { orderId: scenario.order.id } }),
      tickets: await prisma.ticket.count({ where: { orderId: scenario.order.id } }),
      orders: await prisma.order.count({ where: { id: scenario.order.id, organizerId: scenario.organizer.id } }),
      ticketType: await prisma.ticketType.findUnique({ where: { id: scenario.ticketType.id }, select: { priceCents: true, remaining: true } })
    };
    expect(countsAfter).toEqual(countsBefore);

    const snapshotAudit = await prisma.auditLog.findFirst({
      where: { entityId: snapshotJson.id, action: "event_layout_snapshot_created" },
      orderBy: { createdAt: "desc" }
    });
    expect(snapshotAudit).toBeTruthy();
    if (snapshotAudit) created.auditLogIds.push(snapshotAudit.id);
    const snapshotMeta = jsonMetadata(snapshotAudit);
    expect(snapshotMeta.reason).toBe("congelar layout para producción auditada");
    expect(snapshotMeta.venueId).toBe(venueJson.id);
    expect(snapshotMeta.templateId).toBe(templateJson.id);
    expect(snapshotMeta.layoutVersionId).toBe(versionJson.id);
    expect(snapshotMeta.eventId).toBe(scenario.event.id);
    expect(snapshotMeta.snapshotHash).toBe(snapshotJson.snapshotHash);
    expect(snapshotMeta.layoutHash).toBe(versionJson.layoutHash);

    const snapshotAuditSerialized = JSON.stringify(snapshotMeta);
    expect(snapshotAuditSerialized).not.toContain(`SECRET-SEAT-snap-v1-${scenario.suffix}`);
    expect(snapshotAuditSerialized).not.toContain(`SECRET-AFTER-SNAPSHOT-${scenario.suffix}`);
    expect(snapshotAuditSerialized).not.toContain(`zone-main-snap-v1-${scenario.suffix}`);
  });
});

function jsonMetadata(row: { metadata?: unknown } | null | undefined) {
  return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, any>
    : {};
}
