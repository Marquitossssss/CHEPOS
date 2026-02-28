# Observability Alerts — Late Payments & Check-in

## Métricas clave
- `late_payment_cases_total{provider,reason}`
- `late_payment_cases_pending{provider}`
- `manual_override_entries_total{reason}`
- `webhook_replays_total{provider}`
- `webhook_signature_invalid_total{provider}`

## PromQL sugerido

### 1) Backlog creciente de late payments
```promql
sum(late_payment_cases_pending) > 20
```

### 2) Tasa de creación de late payments (5m)
```promql
sum by (provider) (rate(late_payment_cases_total[5m]))
```

### 3) Spike de firmas inválidas (15m)
```promql
sum by (provider) (increase(webhook_signature_invalid_total[15m])) > 10
```

### 4) Spike de replays (15m)
```promql
sum by (provider) (increase(webhook_replays_total[15m])) > 20
```

### 5) Override rate (con volumen mínimo)
```promql
(
  sum(increase(manual_override_entries_total[1h]))
/
  sum(increase(checkin_scan_total{status="valid"}[1h]))
) > 0.01
and
sum(increase(checkin_scan_total{status="valid"}[1h])) >= 200
```

## Umbrales default (configurables)
- `manual_override_rate > 1%` (1h) => warning
- `manual_override_rate > 3%` (30m) => critical
- `manual_override_entries_total > 20/h` => guardrail absoluto
- `webhook_signature_invalid_total` spike => warning/critical según provider
- `late_payment_cases_pending` creciendo sostenido => warning operativo

## Rationale
- Alerts por ratio sin volumen mínimo generan falso positivo en eventos chicos.
- Backlog de pending alto indica riesgo de cola operativa y SLA incumplido.
- Firmas inválidas/replays altos pueden indicar error de integración o abuso.
