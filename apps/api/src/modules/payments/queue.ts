import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../../lib/env.js";

export const paymentsConnection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

export const paymentsQueue = new Queue("payments", {
  connection: paymentsConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnFail: false,
    removeOnComplete: false
  }
});

export type FetchPaymentDetailsJob = {
  type: "fetch_payment_details";
  provider: "mercadopago";
  providerPaymentId: string;
  providerEventId: string;
  correlationId?: string;
};
