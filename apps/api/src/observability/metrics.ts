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

export const paymentWebhookReceivedTotal = getOrCreateCounter(
  "payment_webhook_received_total",
  "Total de webhooks de pago recibidos",
  ["provider", "event_type"]
);

export const paymentWebhookDedupedTotal = getOrCreateCounter(
  "payment_webhook_deduped_total",
  "Total de webhooks de pago deduplicados",
  ["provider"]
);

export const paymentWebhookRejectedTotal = getOrCreateCounter(
  "payment_webhook_rejected_total",
  "Total de webhooks de pago rechazados",
  ["provider", "reason"]
);
