# Late Payments Ops Playbook

## Qué es un LatePaymentCase
Caso operativo creado cuando llega confirmación de pago tardía y la orden converge a `paid_no_stock`.

Contrato mínimo:
- `paid_no_stock` significa: el pago quedó registrado, pero llegó después de `reservedUntil`; la orden perdió derecho automático a stock.
- El webhook tardío registra `Payment`, no emite tickets, libera/restaura cualquier reservation activa y crea un `LatePaymentCase` `PENDING`.
- La creación es idempotente por `provider + providerPaymentId` y por `orderId + paymentAttemptId`.
- El caso mantiene trazabilidad a `Order`, `Event`, `Organizer`, `Payment` (`paymentAttemptId`) y provider payment (`providerPaymentId`).
- Resolver un caso exige motivo (`resolutionNotes`) y deja `DomainEvent` + `AuditLog` con before/after.

## Estados
- `PENDING`: pendiente de revisión operativa.
- `ACCEPTED`: aceptado operativamente.
- `REJECTED`: rechazado operativamente.
- `REFUND_REQUESTED`: reembolso solicitado.
- `REFUNDED`: reembolso concretado.

## Triage de PENDING
1. Buscar pendientes: `GET /late-payment-cases?organizerId=<uuid>&status=PENDING`
2. Revisar evidencia mínima:
   - `orderId`, `provider`, `providerPaymentId/paymentAttemptId`
   - `inventoryReleased`
   - `detectedAt`
3. Resolver: `POST /late-payment-cases/:id/resolve`
   - acción: `ACCEPT | REJECT | REFUND_REQUESTED | REFUNDED`
   - `resolutionNotes` obligatorio

## Qué NO hace este flujo
- No emite tickets manualmente.
- No ejecuta refunds reales contra PSP.
- No cambia stock al resolver el caso.
- No reemplaza un módulo de soporte/helpdesk.

## Logs a consultar
- Webhook recibido/replay:
  - `correlationId`, `provider`, `externalEventId`
- Resolución de caso:
  - `correlationId`, `caseId`, `orderId`, `action`, `actorId`, `previousStatus`, `status`

## Seguridad webhook
- Firma HMAC SHA-256 en `x-webhook-signature`
- Payload firmado:
  - con timestamp: `x-webhook-timestamp + "." + rawBody`
  - sin timestamp: `rawBody`
- Ventana timestamp válida: ±300s
- En `NODE_ENV=production` es obligatorio `PAYMENTS_WEBHOOK_SECRET`

## Qué hacer si suben errores de firma
1. Verificar secret en deploy (`PAYMENTS_WEBHOOK_SECRET`).
2. Confirmar formato de firma del provider.
3. Revisar clock skew en servidores (NTP).
4. Revisar `webhook_signature_invalid_total{provider}`.

## Qué hacer si suben replays
1. Verificar duplicación en provider y latencia de red.
2. Revisar `webhook_replays_total{provider}`.
3. Confirmar estabilidad de `externalEventId` por provider.
4. Escalar a integración PSP si hay patrón anómalo.
