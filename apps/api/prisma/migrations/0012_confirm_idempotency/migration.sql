-- Idempotency key for /checkout/confirm.
-- Stores clientRequestId bound to orderId + paymentReference.
-- On replay: same payload → return existing order (safe).
-- On conflict: same clientRequestId + different payload → 409 (client bug).
CREATE TABLE "ConfirmIdempotencyKey" (
 "id" UUID NOT NULL DEFAULT gen_random_uuid(),
 "clientRequestId" TEXT NOT NULL,
 "orderId" UUID NOT NULL,
 "paymentReference" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ConfirmIdempotencyKey_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ConfirmIdempotencyKey_orderId_fkey"
 FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ConfirmIdempotencyKey_clientRequestId_key"
 ON "ConfirmIdempotencyKey"("clientRequestId");

CREATE INDEX "ConfirmIdempotencyKey_orderId_idx"
 ON "ConfirmIdempotencyKey"("orderId");

CREATE INDEX "ConfirmIdempotencyKey_createdAt_idx"
 ON "ConfirmIdempotencyKey"("createdAt");
