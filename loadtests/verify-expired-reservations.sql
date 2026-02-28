-- Verificación operativa: reservas expiradas que siguen sin releasedAt (stock congelado potencial)
-- Scope por EVENT_ID o TICKET_TYPE_ID.

WITH scoped_ticket_types AS (
  SELECT tt.id
  FROM "TicketType" tt
  WHERE (
    NULLIF(:'EVENT_ID', '') IS NOT NULL AND tt."eventId" = NULLIF(:'EVENT_ID', '')::uuid
  )
  OR (
    NULLIF(:'TICKET_TYPE_ID', '') IS NOT NULL AND tt.id = NULLIF(:'TICKET_TYPE_ID', '')::uuid
  )
)
SELECT
  ir.id,
  ir."orderId" AS order_id,
  ir."ticketTypeId" AS ticket_type_id,
  ir.quantity,
  ir."expiresAt" AS expires_at,
  ir."releasedAt" AS released_at,
  (ir."expiresAt" < NOW() AND ir."releasedAt" IS NULL) AS stale_expired_unreleased
FROM "InventoryReservation" ir
JOIN scoped_ticket_types st ON st.id = ir."ticketTypeId"
WHERE ir."expiresAt" < NOW()
  AND ir."releasedAt" IS NULL
ORDER BY ir."expiresAt" ASC;
