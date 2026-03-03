CREATE TYPE "PaymentProviderEventStatus" AS ENUM ('received', 'processed', 'deduped', 'invalid', 'error');
CREATE TYPE "PaymentIdempotencyStatus" AS ENUM ('in_progress', 'completed', 'failed');

CREATE TABLE "PaymentProviderEvent" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "orderId" TEXT,
  "payloadHash" TEXT NOT NULL,
  "status" "PaymentProviderEventStatus" NOT NULL DEFAULT 'received',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentIdempotencyKey" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "orderId" TEXT,
  "status" "PaymentIdempotencyStatus" NOT NULL DEFAULT 'in_progress',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "PaymentIdempotencyKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentProviderEvent_provider_providerEventId_key" ON "PaymentProviderEvent"("provider", "providerEventId");
CREATE INDEX "PaymentProviderEvent_status_receivedAt_idx" ON "PaymentProviderEvent"("status", "receivedAt");
CREATE INDEX "PaymentProviderEvent_orderId_receivedAt_idx" ON "PaymentProviderEvent"("orderId", "receivedAt");

CREATE UNIQUE INDEX "PaymentIdempotencyKey_provider_idempotencyKey_key" ON "PaymentIdempotencyKey"("provider", "idempotencyKey");
CREATE INDEX "PaymentIdempotencyKey_status_createdAt_idx" ON "PaymentIdempotencyKey"("status", "createdAt");
CREATE INDEX "PaymentIdempotencyKey_orderId_createdAt_idx" ON "PaymentIdempotencyKey"("orderId", "createdAt");

ALTER TABLE "PaymentProviderEvent"
  ADD CONSTRAINT "PaymentProviderEvent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentIdempotencyKey"
  ADD CONSTRAINT "PaymentIdempotencyKey_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Retention policy note: keep dedupe/idempotency records at least 30 days.
-- TODO(ops): enforce retention with scheduled cleanup once operational window is agreed.
