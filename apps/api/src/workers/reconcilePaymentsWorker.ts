import "dotenv/config";
import { pino } from "pino";
import { Counter, collectDefaultMetrics } from "prom-client";
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { paymentsConnection } from "../modules/payments/queue.js";
import { fetchMercadoPagoPayment } from "../modules/payments/mercadopago-provider.js";
import { runPaymentsReconciliationCycle } from "../modules/payments/reconcile-payments.js";

const logger = pino().child({ service: "worker", queue: "payments" });
collectDefaultMetrics();

const reconcileRunsTotal = new Counter({ name: "payments_reconcile_runs_total", help: "Runs de reconciliación", labelNames: ["status"] });
const intervalMs = Number(process.env.PAYMENTS_RECONCILE_INTERVAL_MS ?? 5 * 60 * 1000);

new Worker("payments", async (job) => {
  if (job.name !== "fetch-payment-details") return;
  const providerPaymentId = String((job.data as any).providerPaymentId ?? "");
  const remote = await fetchMercadoPagoPayment(providerPaymentId);
  if (!remote) return;

  const orderId = (typeof remote.external_reference === "string" && /^[0-9a-f-]{36}$/i.test(remote.external_reference))
    ? remote.external_reference
    : (typeof remote.metadata?.orderId === "string" ? String(remote.metadata.orderId) : null);

  await prisma.paymentAttempt.upsert({
    where: { provider_providerPaymentId: { provider: "mercadopago", providerPaymentId } },
    update: { orderId: orderId ?? undefined, status: remote.status, rawPayload: remote as any, lastSeenAt: new Date(), correlationId: (job.data as any).correlationId },
    create: { provider: "mercadopago", providerPaymentId, orderId: orderId ?? undefined, status: remote.status, rawPayload: remote as any, correlationId: (job.data as any).correlationId }
  });
}, { connection: paymentsConnection });

setInterval(async () => {
  try {
    await runPaymentsReconciliationCycle();
    reconcileRunsTotal.inc({ status: "ok" });
  } catch (error) {
    logger.error({ err: error }, "reconcile-payments run failed");
    reconcileRunsTotal.inc({ status: "error" });
  }
}, intervalMs);

void runPaymentsReconciliationCycle();
logger.info({ intervalMs }, "reconcile-payments worker started");
