-- Idempotency table for /checkout/reserve requests.
-- clientRequestId must be supplied by the client (never auto-generated server-side).
-- Same clientRequestId => same orderId returned. No duplicate orders, no duplicate reservations.
CREATE TABLE "ReserveIdempotencyKey" (
  "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "clientRequestId" TEXT        NOT NULL,
  "orderId"         UUID,
  "status"          TEXT        NOT NULL DEFAULT 'completed',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReserveIdempotencyKey_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReserveIdempotencyKey_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReserveIdempotencyKey_clientRequestId_key"
  ON "ReserveIdempotencyKey"("clientRequestId");

CREATE INDEX "ReserveIdempotencyKey_orderId_idx"
  ON "ReserveIdempotencyKey"("orderId");

CREATE INDEX "ReserveIdempotencyKey_createdAt_idx"
  ON "ReserveIdempotencyKey"("createdAt");
