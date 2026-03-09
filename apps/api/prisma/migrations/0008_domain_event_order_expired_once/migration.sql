-- Prevents duplicate ORDER_EXPIRED domain events under concurrent TTL workers.
-- Mirrors the same pattern used for ORDER_PAID and TICKETS_ISSUED in migration 0007.
CREATE UNIQUE INDEX "DomainEvent_order_expired_once_key"
  ON "DomainEvent"("aggregateId", "type")
  WHERE "type" = 'ORDER_EXPIRED';
