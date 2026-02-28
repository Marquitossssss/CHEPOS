import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Counter, Gauge, Histogram, collectDefaultMetrics, register } from "prom-client";
import { confirmSchema, reserveSchema } from "@articket/shared";
import { prisma } from "./lib/prisma.js";
import { env } from "./lib/env.js";
import { generateTicketCode, verifyTicketCode } from "./lib/qr.js";
import { notificationQueue } from "./modules/notifications/queue.js";
import { emitDomainEvent } from "./lib/domainEvents.js";
import { DomainEventName } from "./domain/events.js";
import {
  latePaymentCasesPending,
  latePaymentCasesTotal,
  manualOverrideEntriesTotal,
  webhookReplaysTotal,
  webhookSignatureInvalidTotal
} from "./observability/metrics.js";
import { ensureNotReplay } from "./modules/payments/webhook-idempotency.js";
import { assertWebhookRateLimitShared } from "./modules/payments/webhook-rate-limit.js";
import { ACTIVITY_EVENT_TYPES, type ActivityEventType, fetchEventActivity } from "./modules/activity/service.js";

const app = Fastify({ logger: true });

collectDefaultMetrics();

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total requests HTTP servidas por la API",
  labelNames: ["method", "route", "status_code"]
});

const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "DuraciÃ³n de requests HTTP en segundos",
  labelNames: ["method", "route"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});

const httpInFlightRequests = new Gauge({
  name: "http_in_flight_requests",
  help: "Requests HTTP en vuelo"
});

const checkoutReserveTotal = new Counter({
  name: "checkout_reserve_total",
  help: "Total de intentos de reserva de checkout",
  labelNames: ["status"]
});

const checkoutConfirmTotal = new Counter({
  name: "checkout_confirm_total",
  help: "Total de confirmaciones de checkout",
  labelNames: ["status"]
});

const ticketValidateTotal = new Counter({
  name: "ticket_validate_total",
  help: "Total de validaciones de ticket por cÃ³digo",
  labelNames: ["status"]
});

const checkinScanTotal = new Counter({
  name: "checkin_scan_total",
  help: "Total de escaneos de check-in",
  labelNames: ["status"]
});

const webhookRateLimitPerWindow = 120;

await app.register(cors, { origin: true });
await app.register(sensible);
await app.register(jwt, { secret: env.jwtAccessSecret });

app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
  req.rawBody = raw;
  try {
    done(null, JSON.parse(raw.toString("utf8")));
  } catch (error) {
    done(error as Error, undefined);
  }
});

app.decorateRequest("correlationId", "");
app.decorateRequest("metricsStartAt", 0n);
app.decorateRequest("rawBody", undefined);

app.addHook("onRequest", async (req, reply) => {
  const incomingCorrelation = req.headers["x-correlation-id"];
  const correlationId = typeof incomingCorrelation === "string" && incomingCorrelation.trim().length > 0
    ? incomingCorrelation
    : req.id;
  req.correlationId = correlationId;
  req.metricsStartAt = process.hrtime.bigint();
  reply.header("x-correlation-id", correlationId);
  httpInFlightRequests.inc();
});

app.addHook("onResponse", async (req, reply) => {
  const route = req.routeOptions?.url ?? "unknown";
  const method = req.method;
  const statusCode = String(reply.statusCode);

  httpRequestsTotal.inc({ method, route, status_code: statusCode });

  if (req.metricsStartAt !== 0n) {
    const elapsed = Number(process.hrtime.bigint() - req.metricsStartAt) / 1_000_000_000;
    httpRequestDuration.observe({ method, route }, elapsed);
  }

  httpInFlightRequests.dec();
});

type JwtPayload = { userId: string; email: string };
type Role = "owner" | "admin" | "staff" | "scanner";

type TicketRow = { id: string; eventId: string; status: string; checkedInAt: Date | null };
type TicketValidation = { valid: true; ticket: TicketRow } | { valid: false; reason: string; ticket?: TicketRow };
type TicketDbLike = { ticket: { findUnique: (args: { where: { code: string }; select: { id: true; eventId: true; status: true; checkedInAt: true } }) => Promise<TicketRow | null> } };

declare module "fastify" {
  interface FastifyRequest {
    correlationId: string;
    metricsStartAt: bigint;
    rawBody?: Buffer;
  }
}

async function verifyAuth(req: FastifyRequest) {
  await req.jwtVerify();
}

async function requireMembership(userId: string, organizerId: string, roles: Role[] = ["owner", "admin", "staff", "scanner"]) {
  const membership = await prisma.membership.findUnique({ where: { userId_organizerId: { userId, organizerId } } });
  if (!membership || !roles.includes(membership.role)) {
    throw app.httpErrors.forbidden("Sin permisos para este organizador");
  }
  return membership;
}

async function syncLatePaymentPendingGauge(provider?: string) {
  const grouped = await prisma.latePaymentCase.groupBy({
    by: ["provider"],
    where: {
      status: "PENDING",
      ...(provider ? { provider } : {})
    },
    _count: { _all: true }
  });

  for (const row of grouped) {
    latePaymentCasesPending.set({ provider: row.provider }, row._count._all);
  }
}

async function validateTicketRecord(db: TicketDbLike, code: string): Promise<TicketValidation> {
  if (!verifyTicketCode(code)) return { valid: false, reason: "Firma invÃ¡lida" };
  const ticket = await db.ticket.findUnique({
    where: { code },
    select: { id: true, eventId: true, status: true, checkedInAt: true }
  });
  if (!ticket) return { valid: false, reason: "Ticket inexistente" };
  if (ticket.status === "void") return { valid: false, reason: "Ticket anulado", ticket };
  if (ticket.status === "checked_in") return { valid: false, reason: "Ya utilizado", ticket };
  return { valid: true, ticket };
}

app.get("/health", async () => ({ ok: true }));

app.get("/metrics", async (req, reply) => {
  if (env.metricsToken) {
    const token = req.headers["x-metrics-token"];
    if (token !== env.metricsToken) {
      throw app.httpErrors.unauthorized("Unauthorized metrics access");
    }
  }

  reply.header("Content-Type", register.contentType);
  return register.metrics();
});

app.post("/auth/register", async (req, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await prisma.user.create({ data: { email: body.email, passwordHash } });
  return reply.send({ id: user.id, email: user.email });
});

app.post("/auth/login", async (req) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    throw app.httpErrors.unauthorized("Credenciales invÃ¡lidas");
  }
  const accessToken = app.jwt.sign({ userId: user.id, email: user.email } as JwtPayload, { expiresIn: "15m" });
  const refreshToken = app.jwt.sign({ userId: user.id, email: user.email } as JwtPayload, {
    expiresIn: "7d"
  });
  return { accessToken, refreshToken };
});

app.post("/auth/refresh", async (req) => {
  const body = z.object({ refreshToken: z.string() }).parse(req.body);
  const payload = await app.jwt.verify<JwtPayload>(body.refreshToken);
  const accessToken = app.jwt.sign({ userId: payload.userId, email: payload.email }, { expiresIn: "15m" });
  return { accessToken };
});

app.post("/auth/logout", async () => ({ ok: true }));

app.post("/organizers", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  const body = z.object({ name: z.string().min(3), slug: z.string().min(3) }).parse(req.body);
  const organizer = await prisma.organizer.create({
    data: {
      name: body.name,
      slug: body.slug,
      memberships: { create: { userId: user.userId, role: "owner" } }
    }
  });
  return organizer;
});

app.get("/organizers", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  return prisma.organizer.findMany({ where: { memberships: { some: { userId: user.userId } } } });
});

app.post("/events", { preHandler: verifyAuth }, async (req: any) => {
  const body = z
    .object({
      organizerId: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
      timezone: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      capacity: z.number().int().positive(),
      visibility: z.enum(["draft", "published", "hidden"]).default("draft")
    })
    .parse(req.body);
  const user = req.user as JwtPayload;
  await requireMembership(user.userId, body.organizerId, ["owner", "admin", "staff"]);
  return prisma.event.create({ data: { ...body, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) } });
});

app.get("/events", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  const query = z.object({ organizerId: z.string().uuid() }).parse(req.query);
  await requireMembership(user.userId, query.organizerId);
  return prisma.event.findMany({ where: { organizerId: query.organizerId } });
});

app.post("/events/:id/ticket-types", { preHandler: verifyAuth }, async (req: any) => {
  const body = z
    .object({
      name: z.string(),
      priceCents: z.number().int().nonnegative(),
      currency: z.string(),
      quota: z.number().int().positive(),
      maxPerOrder: z.number().int().positive().default(10)
    })
    .parse(req.body);
  const user = req.user as JwtPayload;
  const event = await prisma.event.findUniqueOrThrow({ where: { id: req.params.id } });
  await requireMembership(user.userId, event.organizerId, ["owner", "admin", "staff"]);
  return prisma.ticketType.create({ data: { ...body, eventId: req.params.id } });
});

app.get("/events/:id/ticket-types", async (req: any) => {
  return prisma.ticketType.findMany({ where: { eventId: req.params.id } });
});

app.post("/checkout/reserve", async (req: any) => {
  const body = reserveSchema.parse(req.body);
  const correlationId = req.correlationId as string;
  req.log.info({ correlationId, eventId: body.eventId }, "checkout reserve request");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  try {
    const order = await prisma.$transaction(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: body.eventId } });
    if (event.organizerId !== body.organizerId) {
      throw new Error("Evento fuera del organizador");
    }

    const ticketTypes = [] as Awaited<ReturnType<typeof tx.ticketType.findUniqueOrThrow>>[];
    let subtotal = 0;

    for (const item of body.items) {
      await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = ${item.ticketTypeId} FOR UPDATE`;
      const tt = await tx.ticketType.findUniqueOrThrow({ where: { id: item.ticketTypeId } });
      if (tt.eventId !== body.eventId) throw new Error("Ticket type invÃ¡lido");
      if (item.quantity > tt.maxPerOrder) throw new Error("Supera mÃ¡ximo por orden");

      const paid = await tx.orderItem.aggregate({
        _sum: { quantity: true },
        where: { ticketTypeId: tt.id, order: { status: "paid" } }
      });
      const activeReservations = await tx.inventoryReservation.aggregate({
        _sum: { quantity: true },
        where: { ticketTypeId: tt.id, releasedAt: null, expiresAt: { gt: now } }
      });
      const used = (paid._sum.quantity ?? 0) + (activeReservations._sum.quantity ?? 0);
      if (used + item.quantity > tt.quota) throw new Error("Sin stock");

      subtotal += tt.priceCents * item.quantity;
      ticketTypes.push(tt);
    }

    const organizer = await tx.organizer.findUniqueOrThrow({ where: { id: event.organizerId } });
    const feeCents = Math.floor((subtotal * organizer.serviceFeeBps) / 10000);
    const taxCents = Math.floor((subtotal * organizer.taxBps) / 10000);
    const totalCents = subtotal + feeCents + taxCents;

    const createdOrder = await tx.order.create({
      data: {
        organizerId: event.organizerId,
        eventId: body.eventId,
        customerEmail: body.customerEmail,
        status: "reserved",
        reservedUntil: expiresAt,
        orderNumber: `ART-${nanoid(10).toUpperCase()}`,
        subtotalCents: subtotal,
        feeCents,
        taxCents,
        totalCents,
        items: {
          create: body.items.map((item: any) => {
            const tt = ticketTypes.find((t) => t.id === item.ticketTypeId)!;
            return {
              ticketTypeId: item.ticketTypeId,
              quantity: item.quantity,
              unitPriceCents: tt.priceCents,
              totalCents: tt.priceCents * item.quantity
            };
          })
        },
        reservations: {
          create: body.items.map((item: any) => ({ ticketTypeId: item.ticketTypeId, quantity: item.quantity, expiresAt }))
        }
      },
      include: { items: true }
    });

    await emitDomainEvent({
      type: DomainEventName.ORDER_RESERVED,
      correlationId: correlationId,
      actorType: "system",
      aggregateType: "order",
      aggregateId: createdOrder.id,
      organizerId: event.organizerId,
      eventId: body.eventId,
      orderId: createdOrder.id,
      context: { source: "checkout.reserve" },
      payload: { customerEmail: body.customerEmail, itemCount: body.items.length, totalCents }
    }, tx);

      return createdOrder;
    });

    checkoutReserveTotal.inc({ status: "reserved" });
    return order;
  } catch (error) {
    checkoutReserveTotal.inc({ status: "error" });
    throw error;
  }
});

app.post("/checkout/confirm", async (req: any) => {
  const body = confirmSchema.parse(req.body);
  const correlationId = req.correlationId as string;
  req.log.info({ correlationId, orderId: body.orderId }, "checkout confirm request");

  try {
    const order = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${body.orderId} FOR UPDATE`;

    const duplicatePayment = await tx.payment.findUnique({
      where: { provider_providerRef: { provider: "mock", providerRef: body.paymentReference } }
    });
    if (duplicatePayment) {
      if (duplicatePayment.orderId !== body.orderId) {
        const conflictError: Error & { statusCode?: number; code?: string } = new Error("Payment reference already used");
        conflictError.statusCode = 409;
        conflictError.code = "PAYMENT_REFERENCE_ALREADY_USED";
        throw conflictError;
      }
      return tx.order.findUnique({ where: { id: duplicatePayment.orderId }, include: { tickets: true } });
    }

    const order = await tx.order.findUnique({ where: { id: body.orderId }, include: { items: true } });
    if (!order) throw new Error("Orden invÃ¡lida");

    if (order.status === "paid") {
      return tx.order.findUnique({ where: { id: order.id }, include: { tickets: true } });
    }
    if (order.status !== "reserved") throw new Error("Estado de orden invÃ¡lido");
    if (!order.reservedUntil || order.reservedUntil < new Date()) throw new Error("Reserva expirada");

    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: "mock",
        providerRef: body.paymentReference,
        status: "paid",
        amountCents: order.totalCents
      }
    });

    await tx.order.update({ where: { id: order.id }, data: { status: "paid" } });

    await emitDomainEvent({
      type: DomainEventName.ORDER_PAID,
      correlationId: correlationId,
      actorType: "system",
      aggregateType: "order",
      aggregateId: order.id,
      organizerId: order.organizerId,
      eventId: order.eventId,
      orderId: order.id,
      context: { source: "checkout.confirm", provider: "mock" },
      payload: { paymentReference: body.paymentReference, amountCents: order.totalCents }
    }, tx);

    const alreadyIssued = await tx.ticket.count({ where: { orderId: order.id } });
    if (alreadyIssued === 0) {
      const rows = order.items.flatMap((item) =>
        Array.from({ length: item.quantity }).map(() => {
          const finalCode = generateTicketCode(nanoid(18));
          return {
            orderId: order.id,
            ticketTypeId: item.ticketTypeId,
            eventId: order.eventId,
            code: finalCode,
            qrPayload: finalCode
          };
        })
      );
      if (rows.length > 0) {
        await tx.ticket.createMany({ data: rows });
        await emitDomainEvent({
          type: DomainEventName.TICKETS_ISSUED,
          correlationId: correlationId,
          actorType: "system",
          aggregateType: "order",
          aggregateId: order.id,
          organizerId: order.organizerId,
          eventId: order.eventId,
          orderId: order.id,
          context: { source: "checkout.confirm" },
          payload: { issuedCount: rows.length }
        }, tx);
      }
    }

    await tx.inventoryReservation.updateMany({ where: { orderId: order.id, releasedAt: null }, data: { releasedAt: new Date() } });
    return tx.order.findUnique({ where: { id: order.id }, include: { tickets: true } });
  });

    if (order?.status === "paid") {
      await notificationQueue.add(
        "order_paid_confirmation",
        { type: "order_paid_confirmation", orderId: order.id, meta: { correlationId } },
        { jobId: `order_paid_confirmation:${order.id}` }
      );
    }

    checkoutConfirmTotal.inc({ status: order?.status === "paid" ? "paid" : "non_paid" });
    return order;
  } catch (error) {
    checkoutConfirmTotal.inc({ status: "error" });
    throw error;
  }
});

app.get("/tickets/validate/:code", async (req: any) => {
  const code = req.params.code;
  const validation = await validateTicketRecord(prisma, code);
  if (!validation.valid) {
    ticketValidateTotal.inc({ status: "invalid" });
    return {
      valid: false,
      reason: validation.reason,
      ...(validation.ticket?.checkedInAt ? { checkedInAt: validation.ticket.checkedInAt } : {})
    };
  }
  ticketValidateTotal.inc({ status: "valid" });
  return { valid: true, ticketId: validation.ticket.id, eventId: validation.ticket.eventId };
});


app.get("/events/:eventId/activity", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  const query = z.object({
    limit: z.coerce.number().int().positive().max(200).optional(),
    cursor: z.string().optional(),
    types: z.string().optional(),
    includePayload: z.coerce.boolean().optional()
  }).parse(req.query ?? {});

  const event = await prisma.event.findUniqueOrThrow({ where: { id: req.params.eventId } });
  await requireMembership(user.userId, event.organizerId, ["owner", "admin", "staff", "scanner"]);

  const types = query.types ? query.types.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
  if (types?.length) {
    const invalid = types.filter((type) => !ACTIVITY_EVENT_TYPES.includes(type as any));
    if (invalid.length > 0) {
      throw app.httpErrors.badRequest(`Tipos de actividad invÃ¡lidos: ${invalid.join(", ")}`);
    }
  }

  const parsedTypes = types as ActivityEventType[] | undefined;

  return fetchEventActivity(prisma, {
    eventId: req.params.eventId,
    userId: user.userId,
    limit: query.limit,
    cursor: query.cursor,
    types: parsedTypes,
    includePayload: query.includePayload
  });
});

app.post("/checkin/scan", { preHandler: verifyAuth }, async (req: any) => {
  const body = z.object({ code: z.string(), gate: z.string().optional(), allowOverride: z.boolean().optional() }).parse(req.body);
  const user = req.user as JwtPayload;
  const correlationId = req.correlationId as string;

  return prisma.$transaction(async (tx) => {
    if (!verifyTicketCode(body.code)) {
      checkinScanTotal.inc({ status: "invalid" });
      return { ok: false, reason: "Firma invÃ¡lida" };
    }

    const lockRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Ticket" WHERE code = ${body.code} FOR UPDATE
    `;

    if (lockRows.length === 0) {
      checkinScanTotal.inc({ status: "invalid" });
      return { ok: false, reason: "Ticket inexistente" };
    }

    const validation = await validateTicketRecord(tx as unknown as TicketDbLike, body.code);
    if (!validation.valid && !validation.ticket) {
      checkinScanTotal.inc({ status: "invalid" });
      return { ok: false, reason: validation.reason };
    }

    const ticket = validation.ticket!;
    const event = await tx.event.findUniqueOrThrow({ where: { id: ticket.eventId } });
    await requireMembership(user.userId, event.organizerId, ["owner", "admin", "staff", "scanner"]);

    if (!validation.valid) {
      await tx.ticketScan.create({
        data: {
          ticketId: ticket.id,
          eventId: ticket.eventId,
          scannedById: user.userId,
          result: "invalid",
          reason: validation.reason,
          gate: body.gate
        }
      });
      checkinScanTotal.inc({ status: "invalid" });
      return { ok: false, reason: validation.reason };
    }

    const current = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    if (current.status === "checked_in" && !body.allowOverride) {
      await tx.ticketScan.create({
        data: {
          ticketId: ticket.id,
          eventId: ticket.eventId,
          scannedById: user.userId,
          result: "invalid",
          reason: "Doble check-in bloqueado",
          gate: body.gate
        }
      });
      checkinScanTotal.inc({ status: "duplicate_blocked" });
      return { ok: false, reason: "Doble check-in bloqueado" };
    }

    if (current.status === "checked_in" && body.allowOverride) {
      manualOverrideEntriesTotal.inc({ reason: "already_checked_in_override" });
      await emitDomainEvent({
        type: DomainEventName.MANUAL_OVERRIDE_EXECUTED,
        correlationId: correlationId,
        actorType: "user",
        actorId: user.userId,
        aggregateType: "ticket",
        aggregateId: ticket.id,
        organizerId: event.organizerId,
        eventId: ticket.eventId,
        orderId: null,
        ticketId: ticket.id,
        context: { source: "checkin.scan", gate: body.gate ?? null, reason: "already_checked_in_override" },
        payload: { scannedByUserId: user.userId }
      }, tx);
    }

    await tx.ticket.update({ where: { id: ticket.id }, data: { status: "checked_in", checkedInAt: new Date(), checkedInBy: user.userId } });
    await tx.ticketScan.create({ data: { ticketId: ticket.id, eventId: ticket.eventId, scannedById: user.userId, result: "valid", gate: body.gate } });

    await emitDomainEvent({
      type: DomainEventName.TICKET_CHECKED_IN,
      correlationId: correlationId,
      actorType: "user",
      actorId: user.userId,
      aggregateType: "ticket",
      aggregateId: ticket.id,
      organizerId: event.organizerId,
      eventId: ticket.eventId,
      orderId: null,
      ticketId: ticket.id,
      context: { source: "checkin.scan", gate: body.gate ?? null },
      payload: { scannedByUserId: user.userId }
    }, tx);

    checkinScanTotal.inc({ status: "valid" });
    return { ok: true };
  });
});


app.post("/orders/:id/resend-confirmation", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  const correlationId = req.correlationId;
  const order = await prisma.order.findUniqueOrThrow({ where: { id: req.params.id }, include: { event: true } });
  await requireMembership(user.userId, order.organizerId, ["owner", "admin", "staff"]);

  await notificationQueue.add(
    "order_paid_confirmation",
    { type: "order_paid_confirmation", orderId: order.id, meta: { correlationId } },
    { jobId: `order_paid_confirmation:${order.id}:manual:${Date.now()}` }
  );

  return { ok: true };
});

app.get("/late-payment-cases", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  const query = z
    .object({
      organizerId: z.string().uuid(),
      provider: z.string().optional(),
      orderId: z.string().uuid().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "REFUND_REQUESTED", "REFUNDED"]).default("PENDING"),
      limit: z.coerce.number().int().positive().max(200).default(50)
    })
    .parse(req.query ?? {});

  await requireMembership(user.userId, query.organizerId, ["owner", "admin", "staff"]);

  return prisma.latePaymentCase.findMany({
    where: {
      status: query.status,
      ...(query.provider ? { provider: query.provider.toLowerCase() } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.from || query.to
        ? {
            detectedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {}),
      order: { organizerId: query.organizerId }
    },
    orderBy: { detectedAt: "desc" },
    take: query.limit
  });
});

app.post("/late-payment-cases/:id/resolve", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  const params = z.object({ id: z.string().uuid() }).parse(req.params);
  const body = z
    .object({
      action: z.enum(["ACCEPT", "REJECT", "REFUND_REQUESTED", "REFUNDED"]),
      resolutionNotes: z.string().max(2000).optional()
    })
    .parse(req.body ?? {});

  const lateCase = await prisma.latePaymentCase.findUnique({
    where: { id: params.id },
    include: { order: { select: { id: true, organizerId: true, eventId: true } } }
  });

  if (!lateCase) {
    throw app.httpErrors.notFound("LatePaymentCase no encontrado");
  }

  await requireMembership(user.userId, lateCase.order.organizerId, ["owner", "admin", "staff"]);

  const statusByAction = {
    ACCEPT: "ACCEPTED",
    REJECT: "REJECTED",
    REFUND_REQUESTED: "REFUND_REQUESTED",
    REFUNDED: "REFUNDED"
  } as const;

  const nextStatus = statusByAction[body.action];
  const allowedTransitions: Record<string, readonly string[]> = {
    PENDING: ["ACCEPTED", "REJECTED", "REFUND_REQUESTED", "REFUNDED"],
    REFUND_REQUESTED: ["REFUNDED"]
  };

  const allowedNext = allowedTransitions[lateCase.status] ?? [];
  if (!allowedNext.includes(nextStatus)) {
    throw app.httpErrors.conflict(`Transición inválida: ${lateCase.status} -> ${nextStatus}`);
  }

  const resolvedAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const updateResult = await tx.latePaymentCase.updateMany({
      where: {
        id: lateCase.id,
        status: lateCase.status,
        version: lateCase.version
      },
      data: {
        status: nextStatus,
        resolutionNotes: body.resolutionNotes ?? null,
        resolvedAt,
        resolvedBy: user.userId,
        version: { increment: 1 }
      }
    });

    if (updateResult.count === 0) {
      req.log.warn({
        correlationId: req.correlationId,
        caseId: lateCase.id,
        attemptedVersion: lateCase.version,
        actorId: user.userId
      }, "late payment resolve conflict");
      throw app.httpErrors.conflict("LatePaymentCase actualizado por otro operador");
    }

    const resolved = await tx.latePaymentCase.findUniqueOrThrow({ where: { id: lateCase.id } });

    await tx.order.update({
      where: { id: lateCase.order.id },
      data: { latePaymentReviewRequired: false }
    });

    await emitDomainEvent({
      type: DomainEventName.LATE_PAYMENT_CASE_RESOLVED,
      correlationId: req.correlationId,
      actorType: "user",
      actorId: user.userId,
      aggregateType: "order",
      aggregateId: lateCase.order.id,
      organizerId: lateCase.order.organizerId,
      eventId: lateCase.order.eventId,
      orderId: lateCase.order.id,
      context: { source: "late-payment-cases.resolve" },
      payload: {
        latePaymentCaseId: lateCase.id,
        action: body.action,
        previousStatus: lateCase.status,
        status: nextStatus,
        resolutionNotes: body.resolutionNotes ?? null
      }
    }, tx);

    return resolved;
  });

  req.log.info({
    correlationId: req.correlationId,
    caseId: lateCase.id,
    orderId: lateCase.order.id,
    action: body.action,
    actorId: user.userId,
    previousStatus: lateCase.status,
    status: updated.status
  }, "late payment case resolved");

  await syncLatePaymentPendingGauge(updated.provider);

  return updated;
});

app.post("/webhooks/payments/:provider", async (req: any) => {
  const params = z.object({ provider: z.string().min(1) }).parse(req.params);
  const body = z
    .object({
      externalEventId: z.string().optional(),
      eventId: z.string().optional(),
      id: z.union([z.string(), z.number()]).optional(),
      orderId: z.string().uuid().optional(),
      paymentAttemptId: z.string().uuid().optional(),
      providerPaymentId: z.string().optional(),
      paymentReference: z.string().optional(),
      status: z.string().optional(),
      reserveId: z.string().uuid().optional()
    })
    .passthrough()
    .parse(req.body ?? {});

  const provider = params.provider.toLowerCase();
  const externalEventId = body.externalEventId ?? body.eventId ?? (body.id ? String(body.id) : undefined);

  try {
    await assertWebhookRateLimitShared({
      provider,
      ip: req.ip ?? "unknown",
      limitPerWindow: webhookRateLimitPerWindow,
      windowSeconds: 60
    });
  } catch (error: any) {
    if (error?.code === "WEBHOOK_RATE_LIMIT") {
      throw app.httpErrors.tooManyRequests("Webhook rate limit exceeded");
    }
    throw error;
  }

  const signature = req.headers["x-webhook-signature"];
  const timestampHeader = req.headers["x-webhook-timestamp"];

  if (env.paymentsWebhookSecret) {
    if (typeof signature !== "string") {
      webhookSignatureInvalidTotal.inc({ provider });
      throw app.httpErrors.unauthorized("invalid webhook signature");
    }

    if (!req.rawBody) {
      webhookSignatureInvalidTotal.inc({ provider });
      throw app.httpErrors.unauthorized("missing raw body for signature verification");
    }

    const rawBody = req.rawBody;
    const timestamp = typeof timestampHeader === "string" ? timestampHeader : "";

    if (timestamp) {
      const ts = Number(timestamp);
      if (!Number.isFinite(ts)) {
        webhookSignatureInvalidTotal.inc({ provider });
        throw app.httpErrors.unauthorized("invalid webhook timestamp");
      }
      const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - ts);
      if (ageSeconds > 300) {
        webhookSignatureInvalidTotal.inc({ provider });
        throw app.httpErrors.unauthorized("stale webhook timestamp");
      }
    }

    const signedPayload = timestamp ? `${timestamp}.${rawBody.toString("utf8")}` : rawBody.toString("utf8");
    const expected = createHmac("sha256", env.paymentsWebhookSecret).update(signedPayload).digest("hex");

    const provided = Buffer.from(signature, "utf8");
    const expectedBuf = Buffer.from(expected, "utf8");
    const valid = provided.length === expectedBuf.length && timingSafeEqual(provided, expectedBuf);

    if (!valid) {
      webhookSignatureInvalidTotal.inc({ provider });
      throw app.httpErrors.unauthorized("invalid webhook signature");
    }
  }

  if (!externalEventId) {
    throw app.httpErrors.badRequest("externalEventId requerido");
  }

  req.log.info({ correlationId: req.correlationId, provider, externalEventId }, "payments webhook received");

  const freshEvent = await ensureNotReplay(provider, externalEventId);
  if (!freshEvent) {
    webhookReplaysTotal.inc({ provider });
    req.log.info({ correlationId: req.correlationId, provider, externalEventId }, "payments webhook replay ignored");
    return { ok: true, replay: true };
  }

  const providerPaymentId = body.providerPaymentId ?? body.paymentReference ?? undefined;
  const paymentStatus = body.status?.toLowerCase() ?? "unknown";
  const paidSignal = ["paid", "approved", "captured", "succeeded", "confirmed"].includes(paymentStatus);

  let orderId = body.orderId;
  let paymentAttemptId = body.paymentAttemptId;

  if (!orderId && providerPaymentId) {
    const payment = await prisma.payment.findUnique({
      where: { provider_providerRef: { provider, providerRef: providerPaymentId } },
      select: { id: true, orderId: true }
    });
    if (payment) {
      orderId = payment.orderId;
      paymentAttemptId = payment.id;
    }
  }

  if (!orderId) {
    return { ok: true, recorded: true, matched: false };
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      reservations: {
        select: { id: true, expiresAt: true, releasedAt: true },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!order) {
    return { ok: true, recorded: true, matched: false };
  }

  const now = new Date();
  const reservation = order.reservations.at(0) ?? null;
  const reservationExpired = order.status === "expired" || (!!order.reservedUntil && order.reservedUntil < now);
  const inventoryReleased = !!reservation?.releasedAt;

  if (paidSignal && reservationExpired && inventoryReleased) {
    const detectedAt = new Date();
    const reserveId = body.reserveId ?? reservation?.id ?? null;

    const lateCaseBase = {
      orderId: order.id,
      reserveId,
      provider,
      providerPaymentId: providerPaymentId ?? null,
      paymentAttemptId: paymentAttemptId ?? null,
      inventoryReleased: true,
      status: "PENDING" as const,
      detectedAt
    };

    let lateCase;
    if (providerPaymentId) {
      lateCase = await prisma.latePaymentCase.upsert({
        where: { provider_providerPaymentId: { provider, providerPaymentId } },
        update: {
          inventoryReleased: true,
          status: "PENDING",
          detectedAt
        },
        create: lateCaseBase
      });
    } else if (paymentAttemptId) {
      lateCase = await prisma.latePaymentCase.upsert({
        where: { orderId_paymentAttemptId: { orderId: order.id, paymentAttemptId } },
        update: {
          inventoryReleased: true,
          status: "PENDING",
          detectedAt
        },
        create: lateCaseBase
      });
    } else {
      lateCase = await prisma.latePaymentCase.create({ data: lateCaseBase });
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { latePaymentReviewRequired: true }
    });

    await prisma.$transaction(async (tx) => {
      await emitDomainEvent({
        type: DomainEventName.LATE_PAYMENT_DETECTED,
        correlationId: req.correlationId,
        actorType: "webhook",
        aggregateType: "order",
        aggregateId: order.id,
        organizerId: order.organizerId,
        eventId: order.eventId,
        orderId: order.id,
        context: { source: "webhooks.payments", provider, externalEventId },
        payload: {
          providerPaymentId: providerPaymentId ?? null,
          paymentAttemptId: paymentAttemptId ?? null,
          inventoryReleased,
          reservationExpired
        }
      }, tx);

      await emitDomainEvent({
        type: DomainEventName.LATE_PAYMENT_CASE_CREATED,
        correlationId: req.correlationId,
        actorType: "webhook",
        aggregateType: "order",
        aggregateId: order.id,
        organizerId: order.organizerId,
        eventId: order.eventId,
        orderId: order.id,
        context: { source: "webhooks.payments", provider, externalEventId },
        payload: {
          latePaymentCaseId: lateCase.id,
          providerPaymentId: providerPaymentId ?? null,
          paymentAttemptId: paymentAttemptId ?? null
        }
      }, tx);
    });

    latePaymentCasesTotal.inc({ provider, reason: "inventory_released_after_expire" });
    await syncLatePaymentPendingGauge(provider);

    return {
      ok: true,
      recorded: true,
      latePaymentCaseId: lateCase.id,
      latePaymentReviewRequired: true
    };
  }

  return { ok: true, recorded: true, matched: true };
});

app.post("/webhooks/sendgrid", async (req: any) => {
  const events = Array.isArray(req.body) ? req.body : [];
  for (const e of events) {
    const sgEventId = e.sg_event_id ? String(e.sg_event_id) : null;
    const common = {
      eventType: String(e.event ?? "unknown"),
      recipient: e.email ? String(e.email) : null,
      messageId: e.sg_message_id ? String(e.sg_message_id) : null,
      payload: e
    };

    if (sgEventId) {
      await prisma.emailEvent.upsert({
        where: { provider_sgEventId: { provider: "sendgrid", sgEventId } },
        update: common,
        create: { provider: "sendgrid", sgEventId, orderId: null, ...common }
      });
    } else {
      await prisma.emailEvent.create({ data: { provider: "sendgrid", sgEventId: null, orderId: null, ...common } });
    }
  }
  return { ok: true };
});

app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, req: FastifyRequest, reply: FastifyReply) => {
  app.log.error({ err: error, correlationId: req.correlationId }, "request failed");
  const status = error.statusCode ?? 400;
  const title = status >= 500 ? "Internal Server Error" : "Bad Request";
  reply.status(status).send({
    type: "about:blank",
    title,
    detail: error.message,
    status,
    ...(error.code ? { code: error.code } : {})
  });
});

await app.listen({ host: "0.0.0.0", port: env.apiPort });

