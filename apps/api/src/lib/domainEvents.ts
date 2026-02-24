import { Prisma, PrismaClient } from "@prisma/client";

export const DOMAIN_EVENT_VERSION = 1;

export const DOMAIN_EVENT_TYPES = [
  "ORDER_RESERVED",
  "ORDER_PAID",
  "TICKETS_ISSUED",
  "TICKET_CHECKED_IN",
  "ORDER_CONFIRMATION_EMAIL_SENT",
  "ORDER_EXPIRED",
  "INVENTORY_RESERVATION_RELEASED"
] as const;

type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

type DomainEventInput = {
  type: DomainEventType;
  correlationId: string;
  actorType: Prisma.DomainActorType;
  actorId?: string | null;
  aggregateType: Prisma.DomainAggregateType;
  aggregateId: string;
  context: Record<string, unknown>;
  payload: Record<string, unknown>;
  eventId?: string | null;
  orderId?: string | null;
  ticketId?: string | null;
  organizerId?: string | null;
};

type DomainEventDb = PrismaClient | Prisma.TransactionClient;

export async function emitDomainEvent(input: DomainEventInput, db: DomainEventDb) {
  await db.domainEvent.create({
    data: {
      type: input.type,
      version: DOMAIN_EVENT_VERSION,
      correlationId: input.correlationId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventId: input.eventId ?? null,
      orderId: input.orderId ?? null,
      ticketId: input.ticketId ?? null,
      organizerId: input.organizerId ?? null,
      context: input.context,
      payload: input.payload
    }
  });
}
