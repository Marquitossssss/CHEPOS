-- Verificación post-test: no sobreventa por ticketTypeId filtrando por EVENT_ID o TICKET_TYPE_ID.
-- Uso recomendado con psql variables:
-- psql "$DATABASE_URL" -v EVENT_ID='<uuid>' -v TICKET_TYPE_ID='' -f loadtests/verify-no-oversell.sql
-- psql "$DATABASE_URL" -v EVENT_ID='' -v TICKET_TYPE_ID='<uuid>' -f loadtests/verify-no-oversell.sql

WITH scope AS (
  SELECT tt.id, tt.quota
  FROM "TicketType" tt
  WHERE (
    NULLIF(:'EVENT_ID', '') IS NOT NULL AND tt."eventId" = NULLIF(:'EVENT_ID', '')::uuid
  )
  OR (
    NULLIF(:'TICKET_TYPE_ID', '') IS NOT NULL AND tt.id = NULLIF(:'TICKET_TYPE_ID', '')::uuid
  )
),
paid AS (
  SELECT
    oi."ticketTypeId" AS ticket_type_id,
    COALESCE(SUM(oi.quantity), 0) AS paid_qty
  FROM "OrderItem" oi
  JOIN "Order" o ON o.id = oi."orderId"
  JOIN scope s ON s.id = oi."ticketTypeId"
  WHERE o.status = 'paid'
  GROUP BY oi."ticketTypeId"
),
active_res AS (
  SELECT
    ir."ticketTypeId" AS ticket_type_id,
    COALESCE(SUM(ir.quantity), 0) AS active_reservations_qty
  FROM "InventoryReservation" ir
  JOIN scope s ON s.id = ir."ticketTypeId"
  WHERE ir."releasedAt" IS NULL
    AND ir."expiresAt" > NOW()
  GROUP BY ir."ticketTypeId"
)
SELECT
  s.id AS ticket_type_id,
  s.quota,
  COALESCE(p.paid_qty, 0) AS paid_qty,
  COALESCE(a.active_reservations_qty, 0) AS active_reservations_qty,
  (COALESCE(p.paid_qty, 0) + COALESCE(a.active_reservations_qty, 0)) AS used_qty,
  ((COALESCE(p.paid_qty, 0) + COALESCE(a.active_reservations_qty, 0)) <= s.quota) AS no_oversell
FROM scope s
LEFT JOIN paid p ON p.ticket_type_id = s.id
LEFT JOIN active_res a ON a.ticket_type_id = s.id
ORDER BY no_oversell ASC, s.id;
