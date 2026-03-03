import { Counter, Gauge, register } from "prom-client";

function getOrCreateCounter(name: string, help: string, labelNames: string[]) {
  const existing = register.getSingleMetric(name) as Counter<string> | undefined;
  if (existing) return existing;

  return new Counter({
    name,
    help,
    labelNames
  });
}

function getOrCreateGauge(name: string, help: string, labelNames: string[]) {
  const existing = register.getSingleMetric(name) as Gauge<string> | undefined;
  if (existing) return existing;

  return new Gauge({
    name,
    help,
    labelNames
  });
}

export const latePaymentCasesTotal = getOrCreateCounter(
  "late_payment_cases_total",
  "Total de late payment cases detectados",
  ["provider", "reason"]
);

export const latePaymentCasesPending = getOrCreateGauge(
  "late_payment_cases_pending",
  "Cantidad de late payment cases pendientes",
  ["provider"]
);

export const manualOverrideEntriesTotal = getOrCreateCounter(
  "manual_override_entries_total",
  "Total de entradas manuales (manual override) en check-in",
  ["reason"]
);

export const webhookReplaysTotal = getOrCreateCounter(
  "webhook_replays_total",
  "Total de webhooks detectados como replay",
  ["provider"]
);

export const webhookSignatureInvalidTotal = getOrCreateCounter(
  "webhook_signature_invalid_total",
  "Total de webhooks rechazados por firma inválida",
  ["provider"]
);

export const paymentsWebhookTotal = getOrCreateCounter(
  "payments_webhook_total",
  "Total de procesamiento de webhooks de pagos por outcome",
  ["provider", "outcome"]
);

export const paymentsIdempotencyDedupTotal = getOrCreateCounter(
  "payments_idempotency_dedup_total",
  "Total de eventos de pago deduplicados por idempotencia",
  ["provider"]
);

export const paymentsPaidTransitionTotal = getOrCreateCounter(
  "payments_paid_transition_total",
  "Total de resultados de transición a paid",
  ["result"]
);

export const paymentsReconcileRunsTotal = getOrCreateCounter(
  "payments_reconcile_runs_total",
  "Runs de reconciliación de pagos",
  ["status"]
);

export const paymentsReconcileProcessedTotal = getOrCreateCounter(
  "payments_reconcile_processed_total",
  "Resultados de reconciliación de pagos",
  ["outcome"]
);
