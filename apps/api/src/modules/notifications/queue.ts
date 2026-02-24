import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../../lib/env.js";

export const notificationConnection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });

export const notificationQueue = new Queue("notifications", {
  connection: notificationConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnFail: false,
    removeOnComplete: false
  }
});

export type OrderPaidJob = {
  type: "order_paid_confirmation";
  orderId: string;
};
