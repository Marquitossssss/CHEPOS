ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECONCILED_PAID';
ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECONCILED_FAILED';

CREATE TABLE "PaymentAttempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID,
  "provider" TEXT NOT NULL,
  "providerPaymentId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amountCents" INT,
  "currency" TEXT,
  "rawPayload" JSONB NOT NULL,
  "correlationId" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reconciledAt" TIMESTAMP(3),
  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentAttempt_provider_providerPaymentId_key" ON "PaymentAttempt"("provider", "providerPaymentId");
CREATE INDEX "PaymentAttempt_orderId_lastSeenAt_idx" ON "PaymentAttempt"("orderId", "lastSeenAt");
CREATE INDEX "PaymentAttempt_status_lastSeenAt_idx" ON "PaymentAttempt"("status", "lastSeenAt");

ALTER TABLE "PaymentAttempt"
  ADD CONSTRAINT "PaymentAttempt_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WebhookReceipt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "orderId" UUID,
  "payloadHash" TEXT NOT NULL,
  "signatureValid" BOOLEAN NOT NULL DEFAULT false,
  "rawPayload" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "correlationId" TEXT,
  CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookReceipt_provider_providerEventId_key" ON "WebhookReceipt"("provider", "providerEventId");
CREATE INDEX "WebhookReceipt_provider_providerPaymentId_receivedAt_idx" ON "WebhookReceipt"("provider", "providerPaymentId", "receivedAt");
CREATE INDEX "WebhookReceipt_orderId_receivedAt_idx" ON "WebhookReceipt"("orderId", "receivedAt");

ALTER TABLE "WebhookReceipt"
  ADD CONSTRAINT "WebhookReceipt_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
