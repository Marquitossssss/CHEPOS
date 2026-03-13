import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";

import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Counter, Gauge, Histogram, collectDefaultMetrics, register } from "prom-client";
import { confirmSchema, reserveSchema } from "@articket/shared";
import { prisma } from "./lib/prisma.js";
import { getOrganizerAuthorizationContext, requireEventCapability, requireOrganizerCapability } from "./lib/adminAuthz.js";
import { env } from "./lib/env.js";
import { generateTicketCode, verifyTicketCode } from "./lib/qr.js";
import { notificationQueue } from "./modules/notifications/queue.js";
import { emitDomainEvent } from "./lib/domainEvents.js";
import { DomainEventName } from "./domain/events.js";
import {
  latePaymentCasesPending,
  latePaymentCasesTotal,
  manualOverrideEntriesTotal,
  paymentEventIgnoredTotal,
  paymentWebhookDedupedTotal,
  paymentWebhookReceivedTotal,
  paymentWebhookRejectedTotal,
  reserveRejectNoStockTotal,
  reserveIdempotentReplayTotal,
  confirmIdempotentReplayTotal
} from "./observability/metrics.js";
import { ACTIVITY_EVENT_TYPES, type ActivityEventType, fetchEventActivity } from "./modules/activity/service.js";
import { registerDashboardRoutes } from "./modules/events/dashboard/dashboard.routes.js";
import { applyPaymentEvent } from "./modules/payments/applyPaymentEvent.js";
import { materializePayment } from "./modules/payments/materializePayment.js";

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


registerDashboardRoutes(app, verifyAuth);

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
    expiresIn: "7d",
    key: env.jwtRefreshSecret
  });
  return { accessToken, refreshToken };
});

app.post("/auth/refresh", async (req) => {
  const body = z.object({ refreshToken: z.string() }).parse(req.body);
  const payload = await app.jwt.verify<JwtPayload>(body.refreshToken, { key: env.jwtRefreshSecret });
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

app.get("/authz/context", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  const query = z.object({ organizerId: z.string().uuid(), eventId: z.string().uuid().optional() }).parse(req.query ?? {});
  const context = await getOrganizerAuthorizationContext(user.userId, query.organizerId);
  if (!context) {
    throw app.httpErrors.forbidden("Sin permisos para este organizador");
  }

  if (query.eventId) {
    const event = await prisma.event.findUnique({ where: { id: query.eventId }, select: { id: true, organizerId: true } });
    if (!event || event.organizerId !== query.organizerId) {
      throw app.httpErrors.badRequest("eventId no pertenece al organizerId indicado");
    }
  }

  return {
    ...context,
    ...(query.eventId ? { scope: "event" as const, eventId: query.eventId } : {})
  };
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
  await requireOrganizerCapability(app, user.userId, body.organizerId, "createEvent");
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
  await requireEventCapability(app, user.userId, req.params.id, "manageTicketTypes");
  return prisma.ticketType.create({ data: { ...body, eventId: req.params.id, remaining: body.quota } });
});

app.get("/events/:id/ticket-types", async (req: any) => {
  return prisma.ticketType.findMany({ where: { eventId: req.params.id } });
});

app.post("/checkout/reserve", async (req: any) => {
  const body = reserveSchema.parse(req.body);
  const correlationId = req.correlationId as string;
  req.log.info({ correlationId, eventId: body.eventId, clientRequestId: body.clientRequestId }, "checkout reserve request");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  // --- IDEMPOTENCY CHECK ---
  // Si ya existe una orden para este clientRequestId, devolverla sin crear nada nuevo.
  const existingKey = await prisma.reserveIdempotencyKey.findUnique({
    where: { clientRequestId: body.clientRequestId },
    include: { order: { include: { items: true } } }
  });

  if (existingKey) {
    if (existingKey.order) {
      req.log.info({ correlationId, clientRequestId: body.clientRequestId, orderId: existingKey.orderId }, "checkout reserve idempotent replay");
      checkoutReserveTotal.inc({ status: "idempotent_replay" });
      reserveIdempotentReplayTotal.inc();
      return existingKey.order;
    }
    // La clave existe pero la orden fue eliminada (SET NULL): tratar como request nueva
  }
  // --- END IDEMPOTENCY CHECK ---

  try {
    const order = await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUniqueOrThrow({ where: { id: body.eventId } });
      if (event.organizerId !== body.organizerId) {
        throw new Error("Evento fuera del organizador");
      }

      const ticketTypes = [] as Awaited<ReturnType<typeof tx.ticketType.findUniqueOrThrow>>[];
      let subtotal = 0;

      // Ordenar items por ticketTypeId para evitar deadlocks por lock ordering
      const sortedItems = [...body.items].sort((a, b) =>
        a.ticketTypeId.localeCompare(b.ticketTypeId)
      );

      for (const item of sortedItems) {
        // FOR UPDATE serializes concurrent reservations on the same TicketType row.
        await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = CAST(${item.ticketTypeId} AS uuid) FOR UPDATE`;
        const tt = await tx.ticketType.findUniqueOrThrow({ where: { id: item.ticketTypeId } });
        if (tt.eventId !== body.eventId) throw new Error("Ticket type inválido");
        if (item.quantity > tt.maxPerOrder) throw new Error("Supera máximo por orden");

        // Atomic decrement with guard. Returns 0 if remaining < quantity (no stock).
        // This replaces the two aggregate queries and is the authoritative stock check.
        const stockUpdated = await tx.$executeRaw`
          UPDATE "TicketType"
          SET remaining = remaining - ${item.quantity}
          WHERE id = CAST(${item.ticketTypeId} AS uuid)
            AND remaining >= ${item.quantity}
        `;
        if (stockUpdated === 0) throw new Error("Sin stock");

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
            create: sortedItems.map((item: any) => {
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
            create: sortedItems.map((item: any) => ({ ticketTypeId: item.ticketTypeId, quantity: item.quantity, expiresAt }))
          }
        },
        include: { items: true }
      });

      // Persistir la clave de idempotencia DENTRO de la transacción.
      // Si la TX falla, la clave no queda guardada y el retry es libre de reintentar.
      // P2002: dos requests concurrentes con el mismo clientRequestId llegaron juntas.
      // La DB garantiza que solo una gana. La que pierde debe buscar la orden ganadora
      // y relanzar el error para que el handler externo la devuelva correctamente.
      try {
        await tx.reserveIdempotencyKey.create({
          data: { clientRequestId: body.clientRequestId, orderId: createdOrder.id }
        });
      } catch (idempotencyError: any) {
        if (idempotencyError?.code === "P2002") {
          // Otra request concurrente ya creó la clave. Relanzar con señal especial
          // para que el handler externo pueda hacer el lookup y devolver esa orden.
          const raceError = new Error("RESERVE_IDEMPOTENCY_RACE");
          (raceError as any).code = "RESERVE_IDEMPOTENCY_RACE";
          throw raceError;
        }
        throw idempotencyError;
      }

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
  } catch (error: any) {
    if (error?.message === "Sin stock") {
      checkoutReserveTotal.inc({ status: "no_stock" });
      reserveRejectNoStockTotal.inc();
      throw error;
    }

    if (error?.code === "RESERVE_IDEMPOTENCY_RACE") {
      // Race condition resuelta: otra TX concurrente ganó con el mismo clientRequestId.
      // Buscar la orden que esa TX creó y devolverla como si fuera un replay normal.
      const winner = await prisma.reserveIdempotencyKey.findUnique({
        where: { clientRequestId: body.clientRequestId },
        include: { order: { include: { items: true } } }
      });
      if (winner?.order) {
        req.log.info({ correlationId, clientRequestId: body.clientRequestId, orderId: winner.orderId }, "checkout reserve idempotent race resolved");
        checkoutReserveTotal.inc({ status: "idempotent_replay" });
        reserveIdempotentReplayTotal.inc();
        return winner.order;
      }
      // Si por alguna razón no existe aún (timing extremo), dejar que suba como error
    }

    checkoutReserveTotal.inc({ status: "error" });
    throw error;
  }
});

app.post("/checkout/confirm", async (req: any) => {
  const body = confirmSchema.parse(req.body);
  const correlationId = req.correlationId as string;
  req.log.info({ correlationId, orderId: body.orderId, clientRequestId: body.clientRequestId }, "checkout confirm request");

  // --- IDEMPOTENCY CHECK ---
  // Fast path: if this clientRequestId was already processed, return the same result.
  // We also validate payload consistency to catch client bugs early (before TX overhead).
  const existingKey = await prisma.confirmIdempotencyKey.findUnique({
    where: { clientRequestId: body.clientRequestId },
    include: { order: { include: { tickets: true } } }
  });

  if (existingKey) {
    // Same clientRequestId but different payload = client bug / security issue.
    // Return 409 so the client knows their state is inconsistent.
    if (existingKey.orderId !== body.orderId || existingKey.paymentReference !== body.paymentReference) {
      req.log.warn({
        correlationId,
        clientRequestId: body.clientRequestId,
        existingOrderId: existingKey.orderId,
        requestedOrderId: body.orderId,
        conflict: "payload_mismatch"
      }, "checkout confirm idempotency conflict");
      const conflictError: Error & { statusCode?: number; code?: string } = new Error(
        "clientRequestId already used with different payload"
      );
      conflictError.statusCode = 409;
      conflictError.code = "CONFIRM_IDEMPOTENCY_CONFLICT";
      throw conflictError;
    }

    // Same payload: safe replay.
    req.log.info({ correlationId, clientRequestId: body.clientRequestId, orderId: body.orderId }, "checkout confirm idempotent replay");
    confirmIdempotentReplayTotal.inc();
    checkoutConfirmTotal.inc({ status: "idempotent_replay" });
    return existingKey.order;
  }
  // --- END IDEMPOTENCY CHECK ---

  try {
    const order = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = CAST(${body.orderId} AS uuid) FOR UPDATE`;

      const order = await tx.order.findUnique({ where: { id: body.orderId }, include: { items: true } });
      if (!order) throw new Error("Orden inválida");

      if (order.status === "paid") {
        // Order already paid (e.g. concurrent webhook arrived first).
        // Enforce paymentReference consistency for new clientRequestId values.
        const existingOrderPayment = await tx.payment.findFirst({
          where: { orderId: order.id, provider: "mock" },
          orderBy: { createdAt: "desc" }
        });

        if (!existingOrderPayment) {
          const stateError: Error & { statusCode?: number; code?: string } = new Error("Paid order without payment record");
          stateError.statusCode = 422;
          stateError.code = "PAID_ORDER_WITHOUT_PAYMENT";
          throw stateError;
        }

        if (existingOrderPayment.providerRef !== body.paymentReference) {
          const conflictError: Error & { statusCode?: number; code?: string } = new Error(
            "Payment reference does not match paid order"
          );
          conflictError.statusCode = 409;
          conflictError.code = "CONFIRM_PAYMENT_REFERENCE_MISMATCH";
          throw conflictError;
        }

        // Persist idempotency key so future retries are fast.
        try {
          await tx.confirmIdempotencyKey.create({
            data: { clientRequestId: body.clientRequestId, orderId: body.orderId, paymentReference: body.paymentReference }
          });
        } catch (e: any) {
          if (e?.code !== "P2002") throw e;
        }
        return tx.order.findUnique({ where: { id: order.id }, include: { tickets: true } });
      }

      if (order.status !== "reserved") throw new Error("Estado de orden inválido");
      if (!order.reservedUntil || order.reservedUntil < new Date()) throw new Error("Reserva expirada");

      const materializedPayment = await materializePayment(tx, {
        orderId: order.id,
        provider: "mock",
        providerRef: body.paymentReference,
        amountCents: order.totalCents,
        status: "paid"
      });

      if (materializedPayment.state === "existing") {
        try {
          await tx.confirmIdempotencyKey.create({
            data: { clientRequestId: body.clientRequestId, orderId: order.id, paymentReference: body.paymentReference }
          });
        } catch (e: any) {
          if (e?.code !== "P2002") throw e;
        }
        return tx.order.findUnique({ where: { id: order.id }, include: { tickets: true } });
      }

      await tx.order.update({ where: { id: order.id }, data: { status: "paid" } });

      await emitDomainEvent({
        type: DomainEventName.ORDER_PAID,
        correlationId,
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
            correlationId,
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

      await tx.inventoryReservation.updateMany({
        where: { orderId: order.id, releasedAt: null },
        data: { releasedAt: new Date(), releaseReason: "consumed_by_payment" }
      });

      // Persist idempotency key inside TX.
      // If TX fails, key is not stored and retry is free to re-attempt.
      // P2002 here means two concurrent confirms raced — both are equivalent, safe to ignore.
      try {
        await tx.confirmIdempotencyKey.create({
          data: { clientRequestId: body.clientRequestId, orderId: order.id, paymentReference: body.paymentReference }
        });
      } catch (e: any) {
        if (e?.code !== "P2002") throw e;
        // Race resolved: another concurrent request created the key. No-op.
      }

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
    types: z.string().optional()
  }).parse(req.query ?? {});

  await requireEventCapability(app, user.userId, req.params.eventId, "viewEventActivity");

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
    types: parsedTypes
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


app.post<{ Params: { id: string } }>("/orders/:id/resend-confirmation", { preHandler: verifyAuth }, async (req) => {
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

  await requireOrganizerCapability(app, user.userId, lateCase.order.organizerId, "resolveLatePayments");

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

app.post<{ Params: { provider: string } }>("/webhooks/payments/:provider", async (req) => {
  const params = z.object({ provider: z.string().min(1) }).parse(req.params);
  const body = (req.body ?? {}) as any;

  const provider = params.provider.toLowerCase();
  const providerEventId =
    (typeof body.id === "string" || typeof body.id === "number")
      ? String(body.id)
      : (typeof body.event_id === "string" || typeof body.event_id === "number")
        ? String(body.event_id)
        : (typeof body.externalEventId === "string" || typeof body.externalEventId === "number")
          ? String(body.externalEventId)
          : (typeof body.eventId === "string" || typeof body.eventId === "number")
            ? String(body.eventId)
            : null;

  if (!providerEventId) {
    paymentWebhookRejectedTotal.inc({ provider, reason: "missing_event_id" });
    req.log.warn({ correlationId: req.correlationId, provider, reason: "missing_event_id" }, "payment webhook rejected");
    throw app.httpErrors.badRequest("providerEventId requerido");
  }

  const providerPaymentIdRaw = body?.data?.id ?? body?.payment_id ?? body?.paymentId;
  const providerPaymentId = providerPaymentIdRaw == null ? null : String(providerPaymentIdRaw);
  const eventType = typeof body.type === "string"
    ? body.type
    : typeof body.event_type === "string"
      ? body.event_type
      : typeof body.topic === "string"
        ? body.topic
        : "unknown";

  const maybeOrderId = body?.data?.metadata?.orderId ?? body?.metadata?.orderId;
  const parsedOrderId = typeof maybeOrderId === "string" && z.string().uuid().safeParse(maybeOrderId).success
    ? maybeOrderId
    : null;

  paymentWebhookReceivedTotal.inc({ provider, event_type: eventType });

  try {
    const created = await prisma.paymentEvent.create({
      data: {
        provider,
        providerEventId,
        providerPaymentId,
        eventType,
        orderId: parsedOrderId,
        payloadJson: body as any
      }
    });

    req.log.info({
      correlationId: req.correlationId,
      provider,
      providerEventId,
      providerPaymentId,
      orderId: parsedOrderId,
      eventType,
      outcome: "stored"
    }, "payment webhook stored");

    try {
      const applyResult = await applyPaymentEvent(created.id, req.correlationId);
      if (["terminal_guard", "unsupported_event_type", "unmatched"].includes(applyResult.outcome)) {
        paymentEventIgnoredTotal.inc({ reason: applyResult.outcome });
      }
      req.log.info({
        correlationId: req.correlationId,
        provider,
        providerEventId,
        eventType,
        outcome: applyResult.outcome
      }, "payment event processed");
    } catch (applyError: any) {
      await prisma.paymentEvent.update({
        where: { id: created.id },
        data: {
          processError: applyError instanceof Error ? applyError.message.slice(0, 1000) : String(applyError).slice(0, 1000)
        }
      });
      req.log.error({ correlationId: req.correlationId, provider, providerEventId, err: applyError }, "payment event process error");

      if (applyError?.code === "MISSING_PAYMENT_IDENTITY") {
        paymentWebhookRejectedTotal.inc({ provider, reason: "missing_payment_identity" });
        const error = app.httpErrors.unprocessableEntity("providerPaymentId requerido para paid webhook");
        (error as any).code = "MISSING_PAYMENT_IDENTITY";
        throw error;
      }

      if (applyError?.code === "PAYMENT_REFERENCE_ALREADY_USED") {
        paymentWebhookRejectedTotal.inc({ provider, reason: "payment_reference_conflict" });
        const error = app.httpErrors.conflict("Payment reference already used");
        (error as any).code = "PAYMENT_REFERENCE_ALREADY_USED";
        throw error;
      }
    }

    return { ok: true, deduped: false };
  } catch (error: any) {
    const uniqueTarget = Array.isArray(error?.meta?.target)
      ? error.meta.target.map(String).join(",")
      : String(error?.meta?.target ?? "");
    const targetNorm = uniqueTarget.toLowerCase();
    const isProviderEventUnique =
      targetNorm.includes("provider") &&
      (targetNorm.includes("providereventid") || targetNorm.includes("provider_event_id") || targetNorm.includes("payment_events_provider_providereventid_key"));

    if (error?.code === "P2002" && isProviderEventUnique) {
      const existing = await prisma.paymentEvent.findUnique({
        where: { provider_providerEventId: { provider, providerEventId } },
        select: { processedAt: true, processError: true }
      });

      if (existing && !existing.processedAt && existing.processError?.includes("providerPaymentId required for paid webhook")) {
        paymentWebhookRejectedTotal.inc({ provider, reason: "missing_payment_identity" });
        const unresolvedError = app.httpErrors.unprocessableEntity("providerPaymentId requerido para paid webhook");
        (unresolvedError as any).code = "MISSING_PAYMENT_IDENTITY";
        throw unresolvedError;
      }

      paymentWebhookDedupedTotal.inc({ provider });
      req.log.info({
        correlationId: req.correlationId,
        provider,
        providerEventId,
        providerPaymentId,
        orderId: parsedOrderId,
        eventType,
        outcome: "deduped"
      }, "payments webhook deduped");
      return { ok: true, deduped: true };
    }

    if (error?.statusCode) throw error;

    paymentWebhookRejectedTotal.inc({ provider, reason: "persistence_error" });
    throw error;
  }
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

