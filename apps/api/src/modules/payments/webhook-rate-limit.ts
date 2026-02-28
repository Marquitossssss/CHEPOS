import { Redis } from "ioredis";
import { env } from "../../lib/env.js";

const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

export async function assertWebhookRateLimitShared(params: {
  provider: string;
  ip: string;
  limitPerWindow: number;
  windowSeconds?: number;
}) {
  const windowSeconds = params.windowSeconds ?? 60;
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `webhook:ratelimit:${params.provider}:${params.ip}:${bucket}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  if (count > params.limitPerWindow) {
    const error = new Error("Webhook rate limit exceeded");
    (error as Error & { code?: string }).code = "WEBHOOK_RATE_LIMIT";
    throw error;
  }
}
