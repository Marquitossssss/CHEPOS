import { createServer } from "node:http";
import pino from "pino";
import { Counter, Histogram, collectDefaultMetrics, register } from "prom-client";
import { Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { notificationConnection } from "../modules/notifications/queue.js";
import { SendGridProvider } from "../modules/notifications/sendgridProvider.js";
import { env } from "../lib/env.js";
import { emitDomainEvent } from "../lib/domainEvents.js";

const logger = pino({ service: "worker", queue: "notifications" });
const provider = new SendGridProvider();

collectDefaultMetrics();

const bullmqJobsTotal = new Counter({
  name: "bullmq_jobs_total",
  help: "Total de jobs procesados en BullMQ",
  labelNames: ["queue", "job_name", "status"]
});

const bullmqJobDuration = new Histogram({
  name: "bullmq_job_duration_seconds",
  help: "Duración de jobs de BullMQ",
  labelNames: ["queue", "job_name"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]
});

const worker = new Worker(
  "notifications",
  async (job) => {
    const startedAt = process.hrtime.bigint();
    const payload = job.data as {
      type: "order_paid_confirmation";
      orderId: string;
      meta?: { correlationId?: string };
    };
    const correlationId = payload.meta?.correlationId ?? `job:${job.id}`;

    if (payload.type !== "order_paid_confirmation") {
      logger.warn({ jobId: job.id, jobName: job.name, attemptsMade: job.attemptsMade, correlationId }, "job type no soportado");
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { tickets: true, event: true }
    });

    if (!order || order.status !== "paid") {
      bullmqJobsTotal.inc({ queue: "notifications", job_name: job.name, status: "skipped" });
      return;
    }
    if (order.confirmationEmailSentAt) {
      bullmqJobsTotal.inc({ queue: "notifications", job_name: job.name, status: "skipped" });
      return;
    }

    const result = await provider.sendTemplateEmail({
      to: order.customerEmail,
      dynamicTemplateId: env.sendgridTemplateOrderPaid,
      dynamicTemplateData: {
        orderNumber: order.orderNumber,
        eventName: order.event.name,
        totalCents: order.totalCents,
        tickets: order.tickets.map((t) => ({ code: t.code }))
      }
    });

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          confirmationEmailSentAt: new Date(),
          confirmationEmailMessageId: result.messageId
        }
      });

      await emitDomainEvent({
        type: "ORDER_CONFIRMATION_EMAIL_SENT",
        correlationId,
        actorType: "worker",
        actorId: String(job.id ?? "notifications"),
        aggregateType: "notification",
        aggregateId: order.id,
        organizerId: order.organizerId,
        eventId: order.eventId,
        orderId: order.id,
        context: { source: "worker.notifications", provider: "sendgrid" },
        payload: { messageId: result.messageId ?? null, recipient: order.customerEmail }
      }, tx);
    });

    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
    bullmqJobDuration.observe({ queue: "notifications", job_name: job.name }, elapsed);
  },
  { connection: notificationConnection }
);

worker.on("completed", (job) => {
  const payload = (job.data ?? {}) as { meta?: { correlationId?: string } };
  bullmqJobsTotal.inc({ queue: "notifications", job_name: job.name, status: "completed" });
  logger.info({
    jobId: job.id,
    jobName: job.name,
    attemptsMade: job.attemptsMade,
    correlationId: payload.meta?.correlationId ?? `job:${job.id}`
  }, "notification job completed");
});

worker.on("failed", (job, err) => {
  const payload = (job?.data ?? {}) as { meta?: { correlationId?: string } };
  bullmqJobsTotal.inc({ queue: "notifications", job_name: job?.name ?? "unknown", status: "failed" });
  logger.error({
    err,
    jobId: job?.id,
    jobName: job?.name,
    attemptsMade: job?.attemptsMade,
    correlationId: payload.meta?.correlationId ?? (job?.id ? `job:${job.id}` : "job:unknown")
  }, "notification job failed");
});

const metricsServer = createServer(async (req, res) => {
  if (!req.url) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  if (req.url === "/health") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/metrics") {
    if (env.metricsToken) {
      const token = req.headers["x-metrics-token"];
      if (token !== env.metricsToken) {
        res.statusCode = 401;
        res.end("Unauthorized");
        return;
      }
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
    return;
  }

  res.statusCode = 404;
  res.end("Not found");
});

metricsServer.listen(env.workerMetricsPort, "0.0.0.0", () => {
  logger.info({ port: env.workerMetricsPort }, "worker metrics server listening");
});
