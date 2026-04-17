-- Payment Methods Config v1
-- Event-level checkout payment method configuration.

CREATE TYPE "CheckoutPaymentMethodType" AS ENUM ('debit_card', 'credit_card');

CREATE TABLE "EventCheckoutPaymentMethod" (
  "id" TEXT NOT NULL,
  "eventId" UUID NOT NULL,
  "methodType" "CheckoutPaymentMethodType" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventCheckoutPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventCheckoutPaymentMethod_eventId_methodType_key"
  ON "EventCheckoutPaymentMethod"("eventId", "methodType");

CREATE INDEX "EventCheckoutPaymentMethod_eventId_enabled_idx"
  ON "EventCheckoutPaymentMethod"("eventId", "enabled");

ALTER TABLE "EventCheckoutPaymentMethod"
  ADD CONSTRAINT "EventCheckoutPaymentMethod_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConfirmIdempotencyKey"
  ADD COLUMN "paymentMethodType" "CheckoutPaymentMethodType";
