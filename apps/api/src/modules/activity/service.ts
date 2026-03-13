import { Prisma, PrismaClient, type OrganizerRole } from "@prisma/client";

type CursorData = { occurredAt: string; id: string };

export const ACTIVITY_EVENT_TYPES = [
  "ORDER_RESERVED",
  "ORDER_PAID",
  "TICKETS_ISSUED",
  "TICKET_CHECKED_IN",
  "ORDER_CONFIRMATION_EMAIL_SENT",
  "ORDER_EXPIRED",
  "INVENTORY_RESERVATION_RELEASED"
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export type ActivityQuery = {
  eventId: string;
  userId: string;
  limit?: number;
  cursor?: string;
  types?: ActivityEventType[];
};

function decodeCursor(cursor?: string): CursorData | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const [occurredAt, id] = raw.split("|");
    if (!occurredAt || !id) return null;
    return { occurredAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(occurredAt: Date, id: string) {
  return Buffer.from(`${occurredAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

const allowedRoles: OrganizerRole[] = ["owner", "admin", "staff", "scanner"];

function summarize(type: string, payload: Record<string, unknown>) {
  if (type === "ORDER_RESERVED") return "Orden reservada";
  if (type === "ORDER_PAID") return "Orden pagada";
  if (type === "TICKETS_ISSUED") return `Tickets emitidos: ${payload.issuedCount ?? "n/a"}`;
  if (type === "TICKET_CHECKED_IN") return "Ticket validado en puerta";
  if (type === "ORDER_CONFIRMATION_EMAIL_SENT") return "Email de confirmación enviado";
  if (type === "ORDER_EXPIRED") return "Orden expirada";
  if (type === "INVENTORY_RESERVATION_RELEASED") return "Reserva de inventario liberada";
  return type;
}

export async function fetchEventActivity(prisma: PrismaClient, query: ActivityQuery) {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const cursor = decodeCursor(query.cursor);

  const event = await prisma.event.findUniqueOrThrow({ where: { id: query.eventId } });
  const membership = await prisma.membership.findUnique({
    where: { userId_organizerId: { userId: query.userId, organizerId: event.organizerId } }
  });

  if (!membership || !allowedRoles.includes(membership.role)) {
    const err: Error & { statusCode?: number } = new Error("FORBIDDEN_ACTIVITY_ACCESS");
    err.statusCode = 403;
    throw err;
  }

  const where: Prisma.DomainEventWhereInput = {
    eventId: query.eventId,
    ...(query.types?.length ? { type: { in: query.types } } : {})
  };

  if (cursor) {
    where.OR = [
      { occurredAt: { lt: new Date(cursor.occurredAt) } },
      { occurredAt: new Date(cursor.occurredAt), id: { lt: cursor.id } }
    ];
  }

  const rows = await prisma.domainEvent.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit + 1
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  const items = slice.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      id: row.id,
      occurredAt: row.occurredAt,
      type: row.type,
      actor: { type: row.actorType, id: row.actorId },
      aggregate: { type: row.aggregateType, id: row.aggregateId },
      summary: summarize(row.type, payload)
    };
  });

  const nextCursor = hasMore ? encodeCursor(slice[slice.length - 1].occurredAt, slice[slice.length - 1].id) : null;

  return { items, nextCursor };
}
