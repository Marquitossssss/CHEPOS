CREATE TABLE "payment_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "eventType" TEXT NOT NULL,
  "orderId" UUID,
  "payloadJson" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "processError" TEXT,
  "ignoredReason" TEXT,
  CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_events_provider_providerEventId_key"
  ON "payment_events"("provider", "providerEventId");

CREATE INDEX "payment_events_orderId_idx"
  ON "payment_events"("orderId");

CREATE INDEX "payment_events_providerPaymentId_idx"
  ON "payment_events"("providerPaymentId");

CREATE INDEX "payment_events_receivedAt_idx"
  ON "payment_events"("receivedAt");

ALTER TABLE "payment_events"
  ADD CONSTRAINT "payment_events_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id")
  ON DELETE SET NULL ON UPDATE RESTRICT;
