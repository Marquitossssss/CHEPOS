ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'RESERVATION_EXPIRED';
ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'INVENTORY_RELEASED';
ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'LATE_PAYMENT_DETECTED';
ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'LATE_PAYMENT_CASE_CREATED';
ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'MANUAL_OVERRIDE_EXECUTED';

CREATE TYPE "LatePaymentCaseStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'REFUNDED');

ALTER TABLE "Order"
  ADD COLUMN "latePaymentReviewRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ProcessedWebhookEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "processedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "ProcessedWebhookEvent_provider_externalEventId_key" UNIQUE ("provider", "externalEventId")
);

CREATE INDEX "ProcessedWebhookEvent_processedAt_idx" ON "ProcessedWebhookEvent"("processedAt");

CREATE TABLE "LatePaymentCase" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "orderId" UUID NOT NULL,
  "reserveId" UUID,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "paymentAttemptId" UUID,
  "inventoryReleased" BOOLEAN NOT NULL DEFAULT false,
  "status" "LatePaymentCaseStatus" NOT NULL DEFAULT 'PENDING',
  "detectedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "resolutionNotes" TEXT,
  "resolvedAt" TIMESTAMP,
  "resolvedBy" TEXT,
  CONSTRAINT "LatePaymentCase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LatePaymentCase_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "LatePaymentCase_provider_providerPaymentId_key" UNIQUE ("provider", "providerPaymentId"),
  CONSTRAINT "LatePaymentCase_orderId_paymentAttemptId_key" UNIQUE ("orderId", "paymentAttemptId")
);

CREATE INDEX "LatePaymentCase_orderId_idx" ON "LatePaymentCase"("orderId");
