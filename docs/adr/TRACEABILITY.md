# ADR Traceability Matrix

Mapea ADR -> módulos de código -> endpoints -> eventos de dominio -> métricas.

## ADR-0000 (Product Reality Baseline)
- Endpoints: transversal (checkout, payments, check-in)
- Domain events: transversal
- Metrics:
  - `http_request_duration_ms`
  - `checkin_latency_ms`
  - `ticket_issuance_latency_ms`
  - disponibilidad mensual (SLA)
- Affected modules (target):
  - `apps/api/src/modules/orders/*`
  - `apps/api/src/modules/payments/*`
  - `apps/api/src/modules/checkin/*`
  - `apps/api/src/modules/metrics/*`

## ADR-0002 (Payments / Idempotency / Reconciliation)
- Endpoints:
  - `POST /orders`
  - `POST /orders/{id}/payment`
  - `POST /webhooks/provider`
- Domain events:
  - `payment.initiated`
  - `payment.confirmed`
  - `order.paid`
  - `late_payment_review.created`
- Metrics:
  - `payment_pending_age_seconds`
  - `payment_provider_errors_total`
  - `webhook_dedup_hits_total`
  - `tickets_issued_without_paid_total`
- Affected modules (target):
  - `apps/api/src/modules/payments/*`
  - `apps/api/src/modules/orders/*`
  - `apps/api/src/workers/*`
  - `apps/api/src/integrations/mercadopago/*`

## ADR-0003 (Check-in Online-only + Manual Fallback)
- Endpoints:
  - `POST /checkin`
- Domain events:
  - `checkin.accepted`
  - `checkin.rejected`
  - `MANUAL_OVERRIDE_STARTED`
  - `MANUAL_OVERRIDE_ENTRY_RECORDED`
  - `MANUAL_OVERRIDE_CLOSED`
- Metrics:
  - `checkin_requests_total`
  - `checkin_error_total`
  - `checkin_already_used_total`
  - `manual_override_entries_total`
- Affected modules (target):
  - `apps/api/src/modules/checkin/*`
  - `apps/api/src/modules/tickets/*`
  - `apps/api/src/modules/audit/*`
  - `apps/web/src/features/checkin/*`

## Notes
- Este mapeo es contractual y debe actualizarse junto con cada ADR.
- Si cambia un endpoint/evento/métrica, actualizar ADR + matriz en el mismo PR.
