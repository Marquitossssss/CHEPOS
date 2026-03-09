ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'paid_no_stock';

ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_MARKED_FAILED';
ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_MARKED_REFUNDED';
ALTER TYPE "DomainEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_MARKED_NO_STOCK';

CREATE UNIQUE INDEX "DomainEvent_order_paid_once_key"
  ON "DomainEvent"("aggregateId", "type")
  WHERE "type" = 'ORDER_PAID';

CREATE UNIQUE INDEX "DomainEvent_tickets_issued_once_key"
  ON "DomainEvent"("aggregateId", "type")
  WHERE "type" = 'TICKETS_ISSUED';
