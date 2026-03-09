-- Materializes available stock as a first-class column.
-- remaining = quota - active_reservations - paid_tickets
-- Decremented atomically at reserve time. Restored at TTL release.
-- Eliminates the two aggregate queries per ticket type per reserve request.

-- Step 1: add as nullable to allow backfill
ALTER TABLE "TicketType" ADD COLUMN "remaining" INT;

-- Step 2: backfill from current state
UPDATE "TicketType" tt
SET "remaining" = tt.quota
  - COALESCE((
      SELECT SUM(ir.quantity)
      FROM "InventoryReservation" ir
      WHERE ir."ticketTypeId" = tt.id
        AND ir."releasedAt" IS NULL
        AND ir."expiresAt" > NOW()
    ), 0)
  - COALESCE((
      SELECT SUM(oi.quantity)
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o.id
      WHERE oi."ticketTypeId" = tt.id
        AND o.status = 'paid'
    ), 0);

-- Step 3: enforce NOT NULL
ALTER TABLE "TicketType" ALTER COLUMN "remaining" SET NOT NULL;

-- Step 4: enforce non-negative invariant at DB level
ALTER TABLE "TicketType"
  ADD CONSTRAINT "TicketType_remaining_non_negative" CHECK ("remaining" >= 0);
