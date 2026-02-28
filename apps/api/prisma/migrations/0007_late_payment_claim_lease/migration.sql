ALTER TABLE "LatePaymentCase"
  ADD COLUMN "claimedBy" TEXT,
  ADD COLUMN "claimedAt" TIMESTAMPTZ,
  ADD COLUMN "claimExpiresAt" TIMESTAMPTZ;

CREATE INDEX "LatePaymentCase_claimExpiresAt_idx" ON "LatePaymentCase"("claimExpiresAt");
