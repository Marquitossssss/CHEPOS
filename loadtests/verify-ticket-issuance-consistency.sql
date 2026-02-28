-- Verificación DB definitiva: para órdenes paid, tickets emitidos == SUM(order_items.quantity)
-- Permite filtrar por EVENT_ID o TICKET_TYPE_ID para scope del test.

WITH scope_orders AS (
  SELECT DISTINCT o.id
  FROM "Order" o
  JOIN "OrderItem" oi ON oi."orderId" = o.id
  JOIN "TicketType" tt ON tt.id = oi."ticketTypeId"
  WHERE o.status = 'paid'
    AND (
      (NULLIF(:'EVENT_ID', '') IS NOT NULL AND o."eventId" = NULLIF(:'EVENT_ID', '')::uuid)
      OR (NULLIF(:'TICKET_TYPE_ID', '') IS NOT NULL AND tt.id = NULLIF(:'TICKET_TYPE_ID', '')::uuid)
    )
),
expected AS (
  SELECT oi."orderId" AS order_id, SUM(oi.quantity) AS expected_tickets
  FROM "OrderItem" oi
  JOIN scope_orders so ON so.id = oi."orderId"
  GROUP BY oi."orderId"
),
emitted AS (
  SELECT t."orderId" AS order_id, COUNT(*)::int AS emitted_tickets
  FROM "Ticket" t
  JOIN scope_orders so ON so.id = t."orderId"
  GROUP BY t."orderId"
)
SELECT
  e.order_id,
  e.expected_tickets,
  COALESCE(m.emitted_tickets, 0) AS emitted_tickets,
  (COALESCE(m.emitted_tickets, 0) = e.expected_tickets) AS consistent
FROM expected e
LEFT JOIN emitted m ON m.order_id = e.order_id
ORDER BY consistent ASC, e.order_id;
