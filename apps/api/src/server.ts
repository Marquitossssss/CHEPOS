import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import sensible from "@fastify/sensible";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import { confirmSchema, reserveSchema } from "@articket/shared/src/index";
import { prisma } from "./lib/prisma.js";
import { env } from "./lib/env.js";
import { generateTicketCode, verifyTicketCode } from "./lib/qr.js";
import { notificationQueue } from "./modules/notifications/queue.js";
import { emitDomainEvent } from "./lib/domainEvents.js";
import { ACTIVITY_EVENT_TYPES, type ActivityEventType, fetchEventActivity } from "./modules/activity/service.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await app.register(sensible);
await app.register(jwt, { secret: env.jwtAccessSecret });

type JwtPayload = { userId: string; email: string };
type Role = "owner" | "admin" | "staff" | "scanner";

type TicketRow = { id: string; eventId: string; status: string; checkedInAt: Date | null };
type TicketValidation = { valid: true; ticket: TicketRow } | { valid: false; reason: string; ticket?: TicketRow };
type TicketDbLike = { ticket: { findUnique: (args: { where: { code: string }; select: { id: true; eventId: true; status: true; checkedInAt: true } }) => Promise<TicketRow | null> } };

async function verifyAuth(req: any) {
  await req.jwtVerify();
}

async function requireMembership(userId: string, organizerId: string, roles: Role[] = ["owner", "admin", "staff", "scanner"]) {
  const membership = await prisma.membership.findUnique({ where: { userId_organizerId: { userId, organizerId } } });
  if (!membership || !roles.includes(membership.role)) {
    throw app.httpErrors.forbidden("Sin permisos para este organizador");
  }
  return membership;
}

async function validateTicketRecord(db: TicketDbLike, code: string): Promise<TicketValidation> {
  if (!verifyTicketCode(code)) return { valid: false, reason: "Firma inválida" };
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
    throw app.httpErrors.unauthorized("Credenciales inválidas");
  }
  const accessToken = app.jwt.sign({ userId: user.id, email: user.email } as JwtPayload, { expiresIn: "15m" });
  const refreshToken = app.jwt.sign({ userId: user.id, email: user.email } as JwtPayload, {
    expiresIn: "7d",
    secret: env.jwtRefreshSecret
  });
  return { accessToken, refreshToken };
});

app.post("/auth/refresh", async (req) => {
  const body = z.object({ refreshToken: z.string() }).parse(req.body);
  const payload = await app.jwt.verify<JwtPayload>(body.refreshToken, { secret: env.jwtRefreshSecret });
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
  const requestId = req.id as string;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: body.eventId } });
    if (event.organizerId !== body.organizerId) {
      throw new Error("Evento fuera del organizador");
    }

    const ticketTypes = [] as Awaited<ReturnType<typeof tx.ticketType.findUniqueOrThrow>>[];
    let subtotal = 0;

    for (const item of body.items) {
      await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = ${item.ticketTypeId} FOR UPDATE`;
      const tt = await tx.ticketType.findUniqueOrThrow({ where: { id: item.ticketTypeId } });
      if (tt.eventId !== body.eventId) throw new Error("Ticket type inválido");
      if (item.quantity > tt.maxPerOrder) throw new Error("Supera máximo por orden");

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
          create: body.items.map((item) => {
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
          create: body.items.map((item) => ({ ticketTypeId: item.ticketTypeId, quantity: item.quantity, expiresAt }))
        }
      },
      include: { items: true }
    });

    await emitDomainEvent({
      type: "ORDER_RESERVED",
      correlationId: requestId,
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
});

app.post("/checkout/confirm", async (req: any) => {
  const body = confirmSchema.parse(req.body);
  const requestId = req.id as string;

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
    if (!order) throw new Error("Orden inválida");

    if (order.status === "paid") {
      return tx.order.findUnique({ where: { id: order.id }, include: { tickets: true } });
    }
    if (order.status !== "reserved") throw new Error("Estado de orden inválido");
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
      type: "ORDER_PAID",
      correlationId: requestId,
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
          type: "TICKETS_ISSUED",
          correlationId: requestId,
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
      { type: "order_paid_confirmation", orderId: order.id },
      { jobId: `order_paid_confirmation:${order.id}` }
    );
  }

  return order;
});

app.get("/tickets/validate/:code", async (req: any) => {
  const code = req.params.code;
  const validation = await validateTicketRecord(prisma, code);
  if (!validation.valid) {
    return {
      valid: false,
      reason: validation.reason,
      ...(validation.ticket?.checkedInAt ? { checkedInAt: validation.ticket.checkedInAt } : {})
    };
  }
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
      throw app.httpErrors.badRequest(`Tipos de actividad inválidos: ${invalid.join(", ")}`);
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

  return prisma.$transaction(async (tx) => {
    if (!verifyTicketCode(body.code)) {
      return { ok: false, reason: "Firma inválida" };
    }

    const lockRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Ticket" WHERE code = ${body.code} FOR UPDATE
    `;

    if (lockRows.length === 0) {
      return { ok: false, reason: "Ticket inexistente" };
    }

    const validation = await validateTicketRecord(tx as TicketDbLike, body.code);
    if (!validation.valid && !validation.ticket) {
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
      return { ok: false, reason: "Doble check-in bloqueado" };
    }

    await tx.ticket.update({ where: { id: ticket.id }, data: { status: "checked_in", checkedInAt: new Date(), checkedInBy: user.userId } });
    await tx.ticketScan.create({ data: { ticketId: ticket.id, eventId: ticket.eventId, scannedById: user.userId, result: "valid", gate: body.gate } });

    await emitDomainEvent({
      type: "TICKET_CHECKED_IN",
      correlationId: req.id,
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

    return { ok: true };
  });
});


app.post("/orders/:id/resend-confirmation", { preHandler: verifyAuth }, async (req: any) => {
  const user = req.user as JwtPayload;
  const order = await prisma.order.findUniqueOrThrow({ where: { id: req.params.id }, include: { event: true } });
  await requireMembership(user.userId, order.organizerId, ["owner", "admin", "staff"]);

  await notificationQueue.add(
    "order_paid_confirmation",
    { type: "order_paid_confirmation", orderId: order.id },
    { jobId: `order_paid_confirmation:${order.id}:manual:${Date.now()}` }
  );

  return { ok: true };
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

app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, _req, reply) => {
  app.log.error({ err: error }, "request failed");
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
