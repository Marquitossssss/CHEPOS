# ADR 0003 - Control de stock por reservas con expiración

En checkout se crea `inventory_reservations` con TTL y estado de orden `reserved`.
La disponibilidad se calcula como `vendido + reservado vigente` y se ejecuta dentro de transacción.
Un job periódico libera reservas expiradas y marca órdenes como `expired`.
