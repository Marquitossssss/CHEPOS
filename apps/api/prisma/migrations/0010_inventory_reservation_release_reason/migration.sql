-- Distinguishes WHY a reservation was released.
-- consumed_by_payment: the order was paid, tickets were issued.
-- expired_by_ttl: the TTL job released it because no payment arrived in time.
-- NULL means released before this column existed (legacy rows).
ALTER TABLE "InventoryReservation" ADD COLUMN "releaseReason" TEXT;
