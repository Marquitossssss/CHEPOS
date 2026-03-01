CREATE TABLE "DomainEventOutbox" (
  "id" UUID NOT NULL,
  "eventName" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "dispatchedAt" TIMESTAMPTZ,
  "retryCount" INT NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "correlationId" TEXT,

  CONSTRAINT "DomainEventOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DomainEventOutbox_dispatchedAt_idx" ON "DomainEventOutbox"("dispatchedAt");
CREATE INDEX "DomainEventOutbox_createdAt_idx" ON "DomainEventOutbox"("createdAt");
