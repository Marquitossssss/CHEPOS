import "dotenv/config";

function requireSecret(name: string, value: string | undefined, minLength = 24): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  if (value.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters`);
  }
  return value;
}

export const env = {
  apiPort: Number(process.env.API_PORT ?? 3000),
  workerMetricsPort: Number(process.env.WORKER_METRICS_PORT ?? 9101),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  metricsToken: process.env.METRICS_TOKEN ?? "",
  jwtAccessSecret: requireSecret("JWT_ACCESS_SECRET", process.env.JWT_ACCESS_SECRET),
  jwtRefreshSecret: requireSecret("JWT_REFRESH_SECRET", process.env.JWT_REFRESH_SECRET),
  qrSecret: requireSecret("QR_SECRET", process.env.QR_SECRET),
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL ?? "noreply@articket.local",
  sendgridTemplateOrderPaid: process.env.SENDGRID_TEMPLATE_ORDER_PAID ?? "",
  paymentsWebhookSecret: process.env.PAYMENTS_WEBHOOK_SECRET ?? ""
};
