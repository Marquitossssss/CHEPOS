import "dotenv/config";

export const env = {
  apiPort: Number(process.env.API_PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? "",
  qrSecret: process.env.QR_SECRET ?? "",
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? "",
  sendgridFromEmail: process.env.SENDGRID_FROM_EMAIL ?? "noreply@articket.local",
  sendgridTemplateOrderPaid: process.env.SENDGRID_TEMPLATE_ORDER_PAID ?? "",
};
