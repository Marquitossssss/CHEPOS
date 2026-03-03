# ADR-0006 - Pagos contract-grade: idempotencia + reconciliación

## Estado
Accepted

## Contexto
Los webhooks pueden llegar duplicados, fuera de orden o incompletos. Para evitar doble emisión de tickets y estados inconsistentes en `Order`, se define una estrategia explícita de deduplicación por recibo, persistencia de intentos de pago y reconciliación activa.

## Decisión
1. Persistir primero `WebhookReceipt(provider, providerEventId)` como dedupe duro.
2. Persistir/actualizar `PaymentAttempt(provider, providerPaymentId)` para correlación y trazabilidad.
3. Aplicar transición a `Order.paid` con función compartida e idempotente (`applyOrderPaidTransition`) bajo transacción con lock por fila.
4. Si el webhook no trae datos suficientes para resolver `orderId`, encolar `fetch-payment-details` (BullMQ con retry/backoff exponencial).
5. Ejecutar `reconcile-payments` cada 5 minutos (configurable) para intentos pendientes entre 10m y 24h.
6. Emitir eventos de dominio `PAYMENT_RECONCILED_PAID` y `PAYMENT_RECONCILED_FAILED`.

## Invariantes
- Un mismo `providerEventId` se procesa una sola vez.
- Un mismo `providerPaymentId` mapea a un único `PaymentAttempt`.
- `Order` no debe emitir tickets duplicados aunque lleguen webhooks duplicados/tardíos.
- `Order.paid` es transición idempotente.

## Failure modes cubiertos
- **Webhook duplicado:** `WebhookReceipt` unique => no-op con 200.
- **Carrera concurrente:** lock + guard de estado en transición compartida.
- **Webhook incompleto:** se guarda raw payload y se difiere enriquecimiento a job.
- **Webhook tardío con orden ya paga:** transición devuelve noop (`already_paid`) y no re-emite tickets.
- **Pérdida de webhook:** reconciliación activa consulta provider y corrige estado.

## Consecuencias
- Más tablas/índices y costo de almacenamiento para trazabilidad.
- Dependencia de Redis/BullMQ para enriquecimiento y reconciliación operativa.
- Mayor robustez contractual en escenarios reales de pagos.
