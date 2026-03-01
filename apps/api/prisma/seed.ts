import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

type SeedProfile = "minimal" | "demo_rich";

type Tx = Prisma.TransactionClient;

const profile = (process.env.SEED_PROFILE ?? "minimal") as SeedProfile;
const ownerEmail = process.env.SEED_OWNER_EMAIL ?? "owner@articket.local";
const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? "afaafc29a40aa";
const bcryptCost = Number.parseInt(process.env.SEED_BCRYPT_COST ?? "12", 10);

function must<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

async function ensureOwner(tx: Tx) {
  const passwordHash = await bcrypt.hash(ownerPassword, Number.isNaN(bcryptCost) ? 12 : bcryptCost);
  return tx.user.upsert({
    where: { email: ownerEmail },
    update: { passwordHash },
    create: { email: ownerEmail, passwordHash }
  });
}

async function ensureOrganizer(tx: Tx, userId: string) {
  const organizer = await tx.organizer.upsert({
    where: { slug: "demo-org" },
    update: { name: "Demo Org", serviceFeeBps: 500, taxBps: 2100 },
    create: { name: "Demo Org", slug: "demo-org", serviceFeeBps: 500, taxBps: 2100 }
  });

  await tx.membership.upsert({
    where: { userId_organizerId: { userId, organizerId: organizer.id } },
    update: { role: "owner" },
    create: { userId, organizerId: organizer.id, role: "owner" }
  });

  return organizer;
}

async function upsertEvent(tx: Tx, organizerId: string, slug: string, data: Omit<Prisma.EventUncheckedCreateInput, "organizerId" | "slug">) {
  return tx.event.upsert({
    where: { organizerId_slug: { organizerId, slug } },
    update: data,
    create: { ...data, organizerId, slug }
  });
}

async function ensureTicketType(
  tx: Tx,
  eventId: string,
  name: string,
  data: Omit<Prisma.TicketTypeUncheckedCreateInput, "eventId" | "name">
) {
  const existing = await tx.ticketType.findFirst({ where: { eventId, name } });
  if (existing) {
    return tx.ticketType.update({
      where: { id: existing.id },
      data: { ...data, name }
    });
  }

  return tx.ticketType.create({
    data: { eventId, name, ...data }
  });
}

async function ensureOrder(
  tx: Tx,
  params: {
    orderNumber: string;
    organizerId: string;
    eventId: string;
    userId: string;
    customerEmail: string;
    status: "pending" | "reserved" | "paid" | "canceled" | "expired" | "refunded";
    subtotalCents: number;
    totalCents: number;
    reservedUntil?: Date | null;
  }
) {
  return tx.order.upsert({
    where: { orderNumber: params.orderNumber },
    update: {
      organizerId: params.organizerId,
      eventId: params.eventId,
      userId: params.userId,
      customerEmail: params.customerEmail,
      status: params.status,
      subtotalCents: params.subtotalCents,
      totalCents: params.totalCents,
      reservedUntil: params.reservedUntil ?? null
    },
    create: {
      organizerId: params.organizerId,
      eventId: params.eventId,
      userId: params.userId,
      orderNumber: params.orderNumber,
      customerEmail: params.customerEmail,
      status: params.status,
      subtotalCents: params.subtotalCents,
      totalCents: params.totalCents,
      reservedUntil: params.reservedUntil ?? null
    }
  });
}

async function ensureOrderItem(tx: Tx, orderId: string, ticketTypeId: string, quantity: number, unitPriceCents: number) {
  const existing = await tx.orderItem.findFirst({ where: { orderId, ticketTypeId } });
  const totalCents = quantity * unitPriceCents;

  if (existing) {
    return tx.orderItem.update({
      where: { id: existing.id },
      data: { quantity, unitPriceCents, totalCents }
    });
  }

  return tx.orderItem.create({
    data: { orderId, ticketTypeId, quantity, unitPriceCents, totalCents }
  });
}

async function ensureTicket(
  tx: Tx,
  code: string,
  data: {
    orderId: string;
    ticketTypeId: string;
    eventId: string;
    status: "issued" | "checked_in" | "void";
    checkedInAt?: Date | null;
    checkedInBy?: string | null;
  }
) {
  return tx.ticket.upsert({
    where: { code },
    update: {
      orderId: data.orderId,
      ticketTypeId: data.ticketTypeId,
      eventId: data.eventId,
      status: data.status,
      qrPayload: `demo-qr-${code}`,
      checkedInAt: data.checkedInAt ?? null,
      checkedInBy: data.checkedInBy ?? null
    },
    create: {
      orderId: data.orderId,
      ticketTypeId: data.ticketTypeId,
      eventId: data.eventId,
      status: data.status,
      code,
      qrPayload: `demo-qr-${code}`,
      checkedInAt: data.checkedInAt ?? null,
      checkedInBy: data.checkedInBy ?? null
    }
  });
}

async function seedMinimal(tx: Tx) {
  const user = await ensureOwner(tx);
  const organizer = await ensureOrganizer(tx, user.id);

  const event = await upsertEvent(tx, organizer.id, "demo-event-1", {
    name: "Concierto Demo",
    description: "Evento demo minimal",
    venue: "Teatro Demo",
    timezone: "America/Argentina/Buenos_Aires",
    startsAt: new Date("2026-10-10T21:00:00.000Z"),
    endsAt: new Date("2026-10-11T01:00:00.000Z"),
    visibility: "published",
    capacity: 1000,
    createdAt: new Date("2026-03-01T00:00:00.000Z")
  });

  const general = await ensureTicketType(tx, event.id, "General", {
    priceCents: 10000,
    currency: "ARS",
    quota: 500,
    maxPerOrder: 10,
    createdAt: new Date("2026-03-01T00:00:00.000Z")
  });

  const order = await ensureOrder(tx, {
    orderNumber: "DEMO-ORDER-0001",
    organizerId: organizer.id,
    eventId: event.id,
    userId: user.id,
    customerEmail: user.email,
    status: "paid",
    subtotalCents: 10000,
    totalCents: 10000
  });

  await ensureOrderItem(tx, order.id, general.id, 1, 10000);
  await ensureTicket(tx, "DEMO-TICKET-0001", {
    orderId: order.id,
    ticketTypeId: general.id,
    eventId: event.id,
    status: "issued"
  });
}

async function seedDemoRich(tx: Tx) {
  const user = await ensureOwner(tx);
  const organizer = await ensureOrganizer(tx, user.id);

  const publishedEvent = await upsertEvent(tx, organizer.id, "demo-event-1", {
    name: "Concierto Demo",
    description: "Evento principal con data rica para control panel",
    venue: "Estadio Demo",
    timezone: "America/Argentina/Buenos_Aires",
    startsAt: new Date("2026-10-10T21:00:00.000Z"),
    endsAt: new Date("2026-10-11T01:00:00.000Z"),
    visibility: "published",
    capacity: 2000,
    createdAt: new Date("2026-03-01T00:00:00.000Z")
  });

  await upsertEvent(tx, organizer.id, "demo-event-2", {
    name: "Demo Draft Event",
    description: "Evento en borrador",
    venue: "Sala Draft",
    timezone: "America/Argentina/Buenos_Aires",
    startsAt: new Date("2026-12-01T20:00:00.000Z"),
    endsAt: new Date("2026-12-01T23:00:00.000Z"),
    visibility: "draft",
    capacity: 800,
    createdAt: new Date("2026-03-02T00:00:00.000Z")
  });

  await upsertEvent(tx, organizer.id, "demo-event-3", {
    name: "Demo Ended Event",
    description: "Evento finalizado",
    venue: "Anfiteatro Demo",
    timezone: "America/Argentina/Buenos_Aires",
    startsAt: new Date("2025-01-10T21:00:00.000Z"),
    endsAt: new Date("2025-01-11T01:00:00.000Z"),
    visibility: "published",
    capacity: 1500,
    createdAt: new Date("2026-03-03T00:00:00.000Z")
  });

  const earlyBird = await ensureTicketType(tx, publishedEvent.id, "Early Bird", {
    priceCents: 7000,
    currency: "ARS",
    quota: 100,
    maxPerOrder: 4,
    createdAt: new Date("2026-03-01T00:00:00.000Z")
  });

  const general = await ensureTicketType(tx, publishedEvent.id, "General", {
    priceCents: 10000,
    currency: "ARS",
    quota: 500,
    maxPerOrder: 6,
    createdAt: new Date("2026-03-01T00:00:00.000Z")
  });

  const vip = await ensureTicketType(tx, publishedEvent.id, "VIP", {
    priceCents: 25000,
    currency: "ARS",
    quota: 50,
    maxPerOrder: 2,
    createdAt: new Date("2026-03-01T00:00:00.000Z")
  });

  await ensureTicketType(tx, publishedEvent.id, "Free Pass", {
    priceCents: 0,
    currency: "ARS",
    quota: 40,
    maxPerOrder: 1,
    createdAt: new Date("2026-03-01T00:00:00.000Z")
  });

  const demoOrders = [
    { n: 1, status: "paid", tt: earlyBird, q: 2, unit: 7000 },
    { n: 2, status: "paid", tt: earlyBird, q: 1, unit: 7000 },
    { n: 3, status: "paid", tt: general, q: 2, unit: 10000 },
    { n: 4, status: "paid", tt: general, q: 1, unit: 10000 },
    { n: 5, status: "paid", tt: general, q: 3, unit: 10000 },
    { n: 6, status: "paid", tt: vip, q: 1, unit: 25000 },
    { n: 7, status: "paid", tt: vip, q: 1, unit: 25000 },
    { n: 8, status: "paid", tt: general, q: 2, unit: 10000 },
    { n: 9, status: "paid", tt: earlyBird, q: 2, unit: 7000 },
    { n: 10, status: "paid", tt: general, q: 1, unit: 10000 },
    { n: 11, status: "paid", tt: general, q: 2, unit: 10000 },
    { n: 12, status: "paid", tt: vip, q: 1, unit: 25000 },
    { n: 13, status: "paid", tt: earlyBird, q: 1, unit: 7000 },
    { n: 14, status: "paid", tt: general, q: 2, unit: 10000 },
    { n: 15, status: "paid", tt: general, q: 1, unit: 10000 },
    { n: 16, status: "paid", tt: vip, q: 1, unit: 25000 },
    { n: 17, status: "paid", tt: general, q: 1, unit: 10000 },
    { n: 18, status: "paid", tt: earlyBird, q: 1, unit: 7000 },
    { n: 19, status: "paid", tt: general, q: 2, unit: 10000 },
    { n: 20, status: "paid", tt: general, q: 1, unit: 10000 },
    { n: 21, status: "paid", tt: vip, q: 1, unit: 25000 },
    { n: 22, status: "paid", tt: general, q: 1, unit: 10000 },
    { n: 23, status: "reserved", tt: vip, q: 2, unit: 25000 },
    { n: 24, status: "reserved", tt: vip, q: 1, unit: 25000 },
    { n: 25, status: "reserved", tt: general, q: 1, unit: 10000 },
    { n: 26, status: "reserved", tt: general, q: 1, unit: 10000 },
    { n: 27, status: "reserved", tt: general, q: 1, unit: 10000 },
    { n: 28, status: "reserved", tt: vip, q: 1, unit: 25000 },
    { n: 29, status: "reserved", tt: general, q: 1, unit: 10000 },
    { n: 30, status: "reserved", tt: earlyBird, q: 1, unit: 7000 },
    { n: 31, status: "pending", tt: general, q: 1, unit: 10000 },
    { n: 32, status: "pending", tt: vip, q: 1, unit: 25000 },
    { n: 33, status: "canceled", tt: general, q: 1, unit: 10000 },
    { n: 34, status: "expired", tt: earlyBird, q: 1, unit: 7000 },
    { n: 35, status: "refunded", tt: vip, q: 1, unit: 25000 }
  ] as const;

  const paidTicketCodes: string[] = [];

  for (const item of demoOrders) {
    const orderNumber = `DEMO-ORDER-${String(item.n).padStart(4, "0")}`;
    const total = item.q * item.unit;

    const reservedUntil = item.status === "reserved"
      ? new Date("2026-10-09T20:00:00.000Z")
      : item.status === "pending"
        ? new Date("2026-10-08T20:00:00.000Z")
        : null;

    const order = await ensureOrder(tx, {
      orderNumber,
      organizerId: organizer.id,
      eventId: publishedEvent.id,
      userId: user.id,
      customerEmail: ownerEmail,
      status: item.status,
      subtotalCents: total,
      totalCents: total,
      reservedUntil
    });

    await ensureOrderItem(tx, order.id, item.tt.id, item.q, item.unit);

    if (item.status === "reserved") {
      const existingReservation = await tx.inventoryReservation.findFirst({
        where: { orderId: order.id, ticketTypeId: item.tt.id, releasedAt: null }
      });

      if (existingReservation) {
        await tx.inventoryReservation.update({
          where: { id: existingReservation.id },
          data: { quantity: item.q, expiresAt: new Date("2026-10-09T21:00:00.000Z") }
        });
      } else {
        await tx.inventoryReservation.create({
          data: {
            orderId: order.id,
            ticketTypeId: item.tt.id,
            quantity: item.q,
            expiresAt: new Date("2026-10-09T21:00:00.000Z")
          }
        });
      }
    }

    if (item.status === "paid") {
      for (let i = 0; i < item.q; i += 1) {
        const ticketCode = `DEMO-TICKET-${String(paidTicketCodes.length + 1).padStart(4, "0")}`;
        paidTicketCodes.push(ticketCode);
        await ensureTicket(tx, ticketCode, {
          orderId: order.id,
          ticketTypeId: item.tt.id,
          eventId: publishedEvent.id,
          status: "issued"
        });
      }

      await tx.payment.upsert({
        where: { provider_providerRef: { provider: "demo", providerRef: `DEMO-PAY-${String(item.n).padStart(4, "0")}` } },
        update: { orderId: order.id, amountCents: total, status: "approved" },
        create: {
          orderId: order.id,
          provider: "demo",
          providerRef: `DEMO-PAY-${String(item.n).padStart(4, "0")}`,
          amountCents: total,
          status: "approved"
        }
      });
    }
  }

  const checkedInCodes = paidTicketCodes.slice(0, 7);
  for (const [idx, code] of checkedInCodes.entries()) {
    const ticket = must(await tx.ticket.findUnique({ where: { code } }), `ticket ${code} not found`);
    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "checked_in",
        checkedInAt: new Date(`2026-10-10T22:${String(10 + idx).padStart(2, "0")}:00.000Z`),
        checkedInBy: user.id
      }
    });
  }

  const checkedInTickets = await tx.ticket.findMany({ where: { code: { in: checkedInCodes } }, select: { id: true } });
  await tx.ticketScan.deleteMany({ where: { ticketId: { in: checkedInTickets.map((t) => t.id) } } });

  for (const [idx, t] of checkedInTickets.entries()) {
    await tx.ticketScan.create({
      data: {
        ticketId: t.id,
        eventId: publishedEvent.id,
        scannedById: user.id,
        result: "ok",
        gate: idx % 2 === 0 ? "Gate A" : "Gate B",
        scannedAt: new Date(`2026-10-10T22:${String(10 + idx).padStart(2, "0")}:00.000Z`)
      }
    });
  }

  const emailFailures = ["bounce", "deferred", "blocked", "spamreport"];
  for (const [idx, type] of emailFailures.entries()) {
    await tx.emailEvent.upsert({
      where: { provider_sgEventId: { provider: "sendgrid", sgEventId: `DEMO-SG-${idx + 1}` } },
      update: { eventType: type, payload: { source: "demo_rich" }, recipient: ownerEmail },
      create: {
        provider: "sendgrid",
        sgEventId: `DEMO-SG-${idx + 1}`,
        eventType: type,
        payload: { source: "demo_rich" },
        recipient: ownerEmail,
        orderId: null
      }
    });
  }

  await tx.domainEvent.deleteMany({ where: { correlationId: { startsWith: "DEMO-" } } });

  const domainEvents: Array<{ type: "ORDER_PAID" | "TICKET_CHECKED_IN"; aggregateType: "order" | "ticket"; aggregateId: string; orderId?: string; ticketId?: string; occurredAt: Date }> = [];

  for (let i = 1; i <= 10; i += 1) {
    const orderNumber = `DEMO-ORDER-${String(i).padStart(4, "0")}`;
    const order = must(await tx.order.findUnique({ where: { orderNumber } }), `order ${orderNumber} missing`);
    domainEvents.push({
      type: "ORDER_PAID",
      aggregateType: "order",
      aggregateId: order.id,
      orderId: order.id,
      occurredAt: new Date(`2026-10-0${Math.min(i, 9)}T12:00:00.000Z`)
    });
  }

  const firstTwoCheckedIn = await tx.ticket.findMany({ where: { code: { in: checkedInCodes.slice(0, 2) } } });
  for (const t of firstTwoCheckedIn) {
    domainEvents.push({
      type: "TICKET_CHECKED_IN",
      aggregateType: "ticket",
      aggregateId: t.id,
      ticketId: t.id,
      occurredAt: new Date("2026-10-10T22:30:00.000Z")
    });
  }

  await tx.domainEvent.createMany({
    data: domainEvents.map((e, idx) => ({
      type: e.type,
      version: 1,
      correlationId: `DEMO-${String(idx + 1).padStart(4, "0")}`,
      actorType: "system",
      actorId: null,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      eventId: publishedEvent.id,
      orderId: e.orderId ?? null,
      ticketId: e.ticketId ?? null,
      organizerId: organizer.id,
      context: { source: "seed.demo_rich" },
      payload: { demo: true },
      occurredAt: e.occurredAt
    }))
  });
}

async function main() {
  if (profile !== "minimal" && profile !== "demo_rich") {
    throw new Error(`SEED_PROFILE inválido: ${profile}`);
  }

  if (profile === "demo_rich") {
    await prisma.$transaction(async (tx) => {
      await seedDemoRich(tx);
    });
    console.log("seed profile applied: demo_rich");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await seedMinimal(tx);
  });
  console.log("seed profile applied: minimal");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
