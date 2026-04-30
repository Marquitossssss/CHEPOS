if (!process.env.API_PORT) process.env.API_PORT = "3436";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "../payments/integrationTestEnv.js";
import type { OrganizerRole } from "@articket/shared";

type AnyJson = Record<string, any>;

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

describe.skipIf(!hasIntegrationEnv)("layout inventory bindings backend foundation", () => {
  const created = {
    userIds: [] as string[],
    organizerIds: [] as string[],
    eventIds: [] as string[],
    ticketTypeIds: [] as string[],
    orderIds: [] as string[],
    ticketIds: [] as string[],
    reservationIds: [] as string[],
    paymentIds: [] as string[],
    venueIds: [] as string[],
    templateIds: [] as string[],
    versionIds: [] as string[],
    snapshotIds: [] as string[],
    bindingIds: [] as string[],
    auditLogIds: [] as string[]
  };

  beforeAll(async () => {
    await import("../../server.js");
    await waitForHealth();
  });

  afterAll(async () => {
    if (created.organizerIds.length === 0) return;

    await prisma.auditLog.deleteMany({ where: { id: { in: created.auditLogIds } } });
    await prisma.eventLayoutInventoryBinding.deleteMany({ where: { id: { in: created.bindingIds } } });
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

  function buildLayoutData(suffix: string, mode: "seated" | "ga" = "seated") {
    const zones = mode === "ga"
      ? [{ id: `zone-ga-${suffix}`, name: `GA ${suffix}`, kind: "standing" as const, capacity: 50 }]
      : [{ id: `zone-main-${suffix}`, name: `Main ${suffix}`, kind: "seated" as const, capacity: 100 }];

    return {
      schemaVersion: "venue-layout.v1",
      canvas: { width: 1200, height: 800, unit: "px" as const },
      zones,
      seats: mode === "ga"
        ? []
        : [{
            id: `seat-a1-${suffix}`,
            label: `A1-${suffix}`,
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

  async function seedScenario() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const organizer = await prisma.organizer.create({
      data: { name: `Binding Org ${suffix}`, slug: `binding-org-${suffix}`, serviceFeeBps: 500, taxBps: 2100 }
    });
    const otherOrganizer = await prisma.organizer.create({
      data: { name: `Binding Other Org ${suffix}`, slug: `binding-other-org-${suffix}`, serviceFeeBps: 500, taxBps: 2100 }
    });
    created.organizerIds.push(organizer.id, otherOrganizer.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Binding Event ${suffix}`,
        slug: `binding-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 500,
        visibility: "published",
        venue: "legacy"
      }
    });
    const otherEvent = await prisma.event.create({
      data: {
        organizerId: otherOrganizer.id,
        name: `Binding Other Event ${suffix}`,
        slug: `binding-other-event-${suffix}`,
        timezone: "America/Buenos_Aires",
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        capacity: 300,
        visibility: "published",
        venue: "legacy-other"
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
    const otherTicketType = await prisma.ticketType.create({
      data: {
        eventId: otherEvent.id,
        name: `Other ${suffix}`,
        priceCents: 2000,
        currency: "ARS",
        quota: 50,
        remaining: 50,
        maxPerOrder: 5
      }
    });
    created.ticketTypeIds.push(ticketType.id, otherTicketType.id);

    const owner = await createUser("owner", organizer.id);
    const admin = await createUser("admin", organizer.id);
    const staff = await createUser("staff", organizer.id);
    const scanner = await createUser("scanner", organizer.id);
    const otherOwner = await createUser("owner", otherOrganizer.id);

    const order = await prisma.order.create({
      data: {
        organizerId: organizer.id,
        eventId: event.id,
        userId: owner.user.id,
        customerEmail: owner.email,
        status: "paid",
        orderNumber: `BIND-${suffix}`,
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
        code: `bind-ticket-${suffix}`,
        qrPayload: `bind-qr-${suffix}`
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

    return { organizer, otherOrganizer, event, otherEvent, ticketType, otherTicketType, owner, admin, staff, scanner, otherOwner, order, ticket, payment, reservation, suffix };
  }

  async function createSnapshotFixture(scenario: Awaited<ReturnType<typeof seedScenario>>, token: string) {
    const venue = await authFetch("/venues", token, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        name: `Binding Venue ${scenario.suffix}`,
        venueType: "theater",
        reason: "crear venue para binding inventory"
      })
    });
    expect(venue.status).toBe(201);
    const venueJson = await venue.json() as AnyJson;
    created.venueIds.push(venueJson.id);

    const template = await authFetch(`/venues/${venueJson.id}/layout-templates`, token, {
      method: "POST",
      body: JSON.stringify({
        name: `Binding Template ${scenario.suffix}`,
        layoutMode: "seated",
        reason: "crear template para binding inventory"
      })
    });
    expect(template.status).toBe(201);
    const templateJson = await template.json() as AnyJson;
    created.templateIds.push(templateJson.id);

    const layoutData = buildLayoutData(`binding-${scenario.suffix}`);
    const version = await authFetch(`/layout-templates/${templateJson.id}/versions`, token, {
      method: "POST",
      body: JSON.stringify({
        schemaVersion: "venue-layout.v1",
        layoutData,
        reason: "crear version para snapshot binding"
      })
    });
    expect(version.status).toBe(201);
    const versionJson = await version.json() as AnyJson;
    created.versionIds.push(versionJson.id);

    const snapshot = await authFetch(`/events/${scenario.event.id}/layout-snapshot`, token, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        layoutVersionId: versionJson.id,
        reason: "crear snapshot base para layout inventory binding"
      })
    });
    expect(snapshot.status).toBe(201);
    const snapshotJson = await snapshot.json() as AnyJson;
    created.snapshotIds.push(snapshotJson.id);

    return { venueJson, templateJson, versionJson, snapshotJson, layoutData };
  }

  function jsonMetadata(row: { metadata?: unknown } | null | undefined) {
    return row?.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, any>
      : {};
  }

  it("enforces authz, scope and read model for layout inventory bindings", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const staffToken = await login(scenario.staff.email, scenario.staff.password);
    const scannerToken = await login(scenario.scanner.email, scenario.scanner.password);
    const otherOwnerToken = await login(scenario.otherOwner.email, scenario.otherOwner.password);
    const fixture = await createSnapshotFixture(scenario, ownerToken);

    const baseBody = {
      organizerId: scenario.organizer.id,
      snapshotId: fixture.snapshotJson.id,
      ticketTypeId: scenario.ticketType.id,
      layoutEntityType: "zone",
      layoutEntityId: fixture.layoutData.zones[0]!.id,
      capacityLimit: 80,
      reason: "crear binding inventory por zona principal"
    };

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, scannerToken, {
      method: "POST",
      body: JSON.stringify(baseBody)
    })).status).toBe(403);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, staffToken, {
      method: "POST",
      body: JSON.stringify(baseBody)
    })).status).toBe(403);

    const countsBefore = {
      remaining: (await prisma.ticketType.findUniqueOrThrow({ where: { id: scenario.ticketType.id } })).remaining,
      quota: (await prisma.ticketType.findUniqueOrThrow({ where: { id: scenario.ticketType.id } })).quota,
      reservations: await prisma.inventoryReservation.count({ where: { ticketTypeId: scenario.ticketType.id } }),
      tickets: await prisma.ticket.count({ where: { eventId: scenario.event.id } }),
      snapshot: await prisma.eventLayoutSnapshot.findUniqueOrThrow({ where: { id: fixture.snapshotJson.id } })
    };

    const createByAdmin = await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      headers: { "x-correlation-id": `bind-${scenario.suffix}` },
      body: JSON.stringify(baseBody)
    });
    expect(createByAdmin.status).toBe(201);
    const createByAdminJson = await createByAdmin.json() as AnyJson;
    created.bindingIds.push(createByAdminJson.id);
    expect(createByAdminJson.inventoryRef).toMatchObject({ type: "ticketType", id: scenario.ticketType.id });
    expect(createByAdminJson.snapshotId).toBe(fixture.snapshotJson.id);

    const staffList = await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings?organizerId=${scenario.organizer.id}`, staffToken);
    expect(staffList.status).toBe(200);
    const staffListJson = await staffList.json() as AnyJson;
    expect(staffListJson.bindings).toHaveLength(1);
    expect(staffListJson.bindings[0]).toMatchObject({
      id: createByAdminJson.id,
      eventId: scenario.event.id,
      snapshotId: fixture.snapshotJson.id,
      layoutEntityType: "zone",
      layoutEntityId: fixture.layoutData.zones[0]!.id,
      inventoryRef: { type: "ticketType", id: scenario.ticketType.id }
    });

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings?organizerId=${scenario.organizer.id}`, otherOwnerToken)).status).toBe(403);
    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, otherOwnerToken, {
      method: "POST",
      body: JSON.stringify(baseBody)
    })).status).toBe(403);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, ownerToken, {
      method: "POST",
      body: JSON.stringify(baseBody)
    })).status).toBe(409);

    const countsAfter = {
      remaining: (await prisma.ticketType.findUniqueOrThrow({ where: { id: scenario.ticketType.id } })).remaining,
      quota: (await prisma.ticketType.findUniqueOrThrow({ where: { id: scenario.ticketType.id } })).quota,
      reservations: await prisma.inventoryReservation.count({ where: { ticketTypeId: scenario.ticketType.id } }),
      tickets: await prisma.ticket.count({ where: { eventId: scenario.event.id } }),
      snapshot: await prisma.eventLayoutSnapshot.findUniqueOrThrow({ where: { id: fixture.snapshotJson.id } })
    };

    expect(countsAfter.remaining).toBe(countsBefore.remaining);
    expect(countsAfter.quota).toBe(countsBefore.quota);
    expect(countsAfter.reservations).toBe(countsBefore.reservations);
    expect(countsAfter.tickets).toBe(countsBefore.tickets);
    expect(stableNormalize(countsAfter.snapshot.snapshotData)).toEqual(stableNormalize(countsBefore.snapshot.snapshotData));
    expect(countsAfter.snapshot.snapshotHash).toBe(countsBefore.snapshot.snapshotHash);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: createByAdminJson.id, action: "event_layout_inventory_binding_created" },
      orderBy: { createdAt: "desc" }
    });
    expect(audit).toBeTruthy();
    if (audit) created.auditLogIds.push(audit.id);
    const auditMeta = jsonMetadata(audit);
    expect(auditMeta.reason).toBe("crear binding inventory por zona principal");
    expect(auditMeta.organizerId).toBe(scenario.organizer.id);
    expect(auditMeta.eventId).toBe(scenario.event.id);
    expect(auditMeta.snapshotId).toBe(fixture.snapshotJson.id);
    expect(auditMeta.inventoryRefType).toBe("ticketType");
    expect(auditMeta.inventoryRefId).toBe(scenario.ticketType.id);
    expect(auditMeta.correlationId).toBe(`bind-${scenario.suffix}`);
    expect(auditMeta.corelationId).toBeUndefined();
    const auditSerialized = JSON.stringify(auditMeta);
    expect(auditSerialized).not.toContain(JSON.stringify(fixture.layoutData));
    expect(auditSerialized).not.toContain(JSON.stringify(fixture.snapshotJson.snapshotData));
  });

  it("validates snapshot entities, ticket type scope and capacity rules", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const otherOwnerToken = await login(scenario.otherOwner.email, scenario.otherOwner.password);
    const fixture = await createSnapshotFixture(scenario, ownerToken);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        snapshotId: "00000000-0000-0000-0000-000000000000",
        ticketTypeId: scenario.ticketType.id,
        layoutEntityType: "zone",
        layoutEntityId: fixture.layoutData.zones[0]!.id,
        reason: "snapshot inexistente debe fallar limpio"
      })
    })).status).toBe(404);

    expect((await authFetch(`/events/${scenario.otherEvent.id}/layout-inventory-bindings`, otherOwnerToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.otherOrganizer.id,
        snapshotId: fixture.snapshotJson.id,
        ticketTypeId: scenario.otherTicketType.id,
        layoutEntityType: "zone",
        layoutEntityId: fixture.layoutData.zones[0]!.id,
        reason: "snapshot de otro event no debe filtrar"
      })
    })).status).toBe(404);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        snapshotId: fixture.snapshotJson.id,
        ticketTypeId: scenario.ticketType.id,
        layoutEntityType: "zone",
        layoutEntityId: "zone-missing",
        reason: "layout entity inexistente debe fallar"
      })
    })).status).toBe(400);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        snapshotId: fixture.snapshotJson.id,
        ticketTypeId: scenario.ticketType.id,
        layoutEntityType: "seat",
        layoutEntityId: fixture.layoutData.seats[0]!.id,
        capacityLimit: 2,
        reason: "seat no puede tener capacityLimit mayor a uno"
      })
    })).status).toBe(400);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        snapshotId: fixture.snapshotJson.id,
        ticketTypeId: scenario.ticketType.id,
        layoutEntityType: "zone",
        layoutEntityId: fixture.layoutData.zones[0]!.id,
        capacityLimit: 101,
        reason: "zone no puede exceder capacidad física"
      })
    })).status).toBe(400);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        snapshotId: fixture.snapshotJson.id,
        ticketTypeId: "00000000-0000-0000-0000-000000000000",
        layoutEntityType: "zone",
        layoutEntityId: fixture.layoutData.zones[0]!.id,
        reason: "ticket type inexistente debe fallar"
      })
    })).status).toBe(404);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        snapshotId: fixture.snapshotJson.id,
        ticketTypeId: scenario.otherTicketType.id,
        layoutEntityType: "zone",
        layoutEntityId: fixture.layoutData.zones[0]!.id,
        reason: "ticket type de otro event no debe filtrar"
      })
    })).status).toBe(404);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        snapshotId: fixture.snapshotJson.id,
        ticketTypeId: scenario.ticketType.id,
        inventoryBucketId: scenario.ticketType.id,
        layoutEntityType: "zone",
        layoutEntityId: fixture.layoutData.zones[0]!.id,
        reason: "no permitir ambos refs a la vez"
      })
    })).status).toBe(400);

    expect((await authFetch(`/events/${scenario.event.id}/layout-inventory-bindings`, adminToken, {
      method: "POST",
      body: JSON.stringify({
        organizerId: scenario.organizer.id,
        snapshotId: fixture.snapshotJson.id,
        layoutEntityType: "zone",
        layoutEntityId: fixture.layoutData.zones[0]!.id,
        reason: "sin ticketTypeId debe fallar"
      })
    })).status).toBe(400);
  });
});
