CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "OrganizerRole" AS ENUM ('owner', 'admin', 'staff', 'scanner');
CREATE TYPE "EventVisibility" AS ENUM ('draft', 'published', 'hidden');
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'reserved', 'paid', 'canceled', 'expired', 'refunded');
CREATE TYPE "TicketStatus" AS ENUM ('issued', 'void', 'checked_in');
CREATE TYPE "DomainEventType" AS ENUM ('ORDER_RESERVED', 'ORDER_PAID', 'TICKETS_ISSUED', 'TICKET_CHECKED_IN', 'ORDER_CONFIRMATION_EMAIL_SENT', 'ORDER_EXPIRED', 'INVENTORY_RESERVATION_RELEASED');
CREATE TYPE "DomainActorType" AS ENUM ('user', 'system', 'worker', 'webhook');
CREATE TYPE "DomainAggregateType" AS ENUM ('order', 'ticket', 'inventory_reservation', 'event', 'notification');

CREATE TABLE "User" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "Organizer" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "serviceFeeBps" INT NOT NULL DEFAULT 0,
  "taxBps" INT NOT NULL DEFAULT 0
);

CREATE TABLE "Membership" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "organizerId" UUID NOT NULL,
  "role" "OrganizerRole" NOT NULL,
  UNIQUE("userId", "organizerId"),
  CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Membership_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Event" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizerId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "venue" TEXT,
  "timezone" TEXT NOT NULL,
  "startsAt" TIMESTAMP NOT NULL,
  "endsAt" TIMESTAMP NOT NULL,
  "visibility" "EventVisibility" NOT NULL DEFAULT 'draft',
  "capacity" INT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE("organizerId", "slug"),
  CONSTRAINT "Event_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TicketType" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "priceCents" INT NOT NULL,
  "currency" TEXT NOT NULL,
  "quota" INT NOT NULL,
  "salesStart" TIMESTAMP,
  "salesEnd" TIMESTAMP,
  "maxPerOrder" INT NOT NULL DEFAULT 10,
  "requiredFields" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "TicketType_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Order" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizerId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "userId" UUID,
  "orderNumber" TEXT NOT NULL UNIQUE,
  "customerEmail" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'pending',
  "subtotalCents" INT NOT NULL DEFAULT 0,
  "feeCents" INT NOT NULL DEFAULT 0,
  "taxCents" INT NOT NULL DEFAULT 0,
  "totalCents" INT NOT NULL DEFAULT 0,
  "reservedUntil" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "confirmationEmailSentAt" TIMESTAMP,
  "confirmationEmailMessageId" TEXT,
  CONSTRAINT "Order_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "OrderItem" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "ticketTypeId" UUID NOT NULL,
  "quantity" INT NOT NULL,
  "unitPriceCents" INT NOT NULL,
  "totalCents" INT NOT NULL,
  CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderItem_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Ticket" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "ticketTypeId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'issued',
  "code" TEXT NOT NULL UNIQUE,
  "qrPayload" TEXT NOT NULL,
  "issuedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "checkedInAt" TIMESTAMP,
  "checkedInBy" TEXT,
  CONSTRAINT "Ticket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Ticket_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Ticket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "TicketScan" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ticketId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "scannedById" UUID,
  "scannedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "result" TEXT NOT NULL,
  "reason" TEXT,
  "gate" TEXT,
  CONSTRAINT "TicketScan_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketScan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketScan_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "InventoryReservation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "ticketTypeId" UUID NOT NULL,
  "quantity" INT NOT NULL,
  "expiresAt" TIMESTAMP NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "releasedAt" TIMESTAMP,
  CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryReservation_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Payment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "providerRef" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amountCents" INT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Payment_provider_providerRef_key" UNIQUE ("provider", "providerRef")
);

CREATE TABLE "EmailEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId" UUID,
  "provider" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "sgEventId" TEXT,
  "messageId" TEXT,
  "recipient" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "EmailEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "EmailEvent_provider_sgEventId_key" UNIQUE ("provider", "sgEventId")
);

CREATE TABLE "DomainEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "type" "DomainEventType" NOT NULL,
  "version" INT NOT NULL DEFAULT 1,
  "correlationId" TEXT,
  "actorType" "DomainActorType" NOT NULL,
  "actorId" TEXT,
  "aggregateType" "DomainAggregateType" NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "eventId" UUID,
  "orderId" UUID,
  "ticketId" UUID,
  "organizerId" UUID,
  "context" JSONB NOT NULL,
  "payload" JSONB NOT NULL,
  "occurredAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE "AuditLog" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizerId" UUID,
  "actorUserId" UUID,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "Organizer_createdAt_idx" ON "Organizer"("createdAt");
CREATE INDEX "Membership_organizerId_role_idx" ON "Membership"("organizerId", "role");
CREATE INDEX "Event_organizerId_visibility_idx" ON "Event"("organizerId", "visibility");
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");
CREATE INDEX "TicketType_eventId_idx" ON "TicketType"("eventId");
CREATE INDEX "TicketType_eventId_salesStart_salesEnd_idx" ON "TicketType"("eventId", "salesStart", "salesEnd");
CREATE INDEX "Order_organizerId_status_createdAt_idx" ON "Order"("organizerId", "status", "createdAt");
CREATE INDEX "Order_eventId_status_idx" ON "Order"("eventId", "status");
CREATE INDEX "Order_reservedUntil_status_idx" ON "Order"("reservedUntil", "status");
CREATE INDEX "OrderItem_ticketTypeId_orderId_idx" ON "OrderItem"("ticketTypeId", "orderId");
CREATE INDEX "Ticket_orderId_idx" ON "Ticket"("orderId");
CREATE INDEX "Ticket_eventId_status_idx" ON "Ticket"("eventId", "status");
CREATE INDEX "TicketScan_eventId_scannedAt_idx" ON "TicketScan"("eventId", "scannedAt");
CREATE INDEX "TicketScan_ticketId_scannedAt_idx" ON "TicketScan"("ticketId", "scannedAt");
CREATE INDEX "InventoryReservation_ticketTypeId_expiresAt_releasedAt_idx" ON "InventoryReservation"("ticketTypeId", "expiresAt", "releasedAt");
CREATE INDEX "InventoryReservation_orderId_releasedAt_idx" ON "InventoryReservation"("orderId", "releasedAt");
CREATE INDEX "Payment_orderId_createdAt_idx" ON "Payment"("orderId", "createdAt");
CREATE INDEX "AuditLog_organizerId_createdAt_idx" ON "AuditLog"("organizerId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

CREATE INDEX "EmailEvent_orderId_createdAt_idx" ON "EmailEvent"("orderId", "createdAt");
CREATE INDEX "EmailEvent_provider_eventType_createdAt_idx" ON "EmailEvent"("provider", "eventType", "createdAt");

CREATE INDEX "DomainEvent_eventId_occurredAt_idx" ON "DomainEvent"("eventId", "occurredAt");
CREATE INDEX "DomainEvent_organizerId_occurredAt_idx" ON "DomainEvent"("organizerId", "occurredAt");
CREATE INDEX "DomainEvent_type_occurredAt_idx" ON "DomainEvent"("type", "occurredAt");
CREATE INDEX "DomainEvent_correlationId_occurredAt_idx" ON "DomainEvent"("correlationId", "occurredAt");
CREATE INDEX "DomainEvent_aggregateType_aggregateId_occurredAt_idx" ON "DomainEvent"("aggregateType", "aggregateId", "occurredAt");
