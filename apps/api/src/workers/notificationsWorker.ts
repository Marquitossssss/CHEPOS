import { Worker } from "bullmq";
import { prisma } from "../lib/prisma.js";
import { notificationConnection } from "../modules/notifications/queue.js";
import { SendGridProvider } from "../modules/notifications/sendgridProvider.js";
import { env } from "../lib/env.js";
import { emitDomainEvent } from "../lib/domainEvents.js";

const provider = new SendGridProvider();

const worker = new Worker(
  "notifications",
  async (job) => {
    const payload = job.data as { type: "order_paid_confirmation"; orderId: string };
    if (payload.type !== "order_paid_confirmation") return;

    const order = await prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { tickets: true, event: true }
    });

    if (!order || order.status !== "paid") return;
    if (order.confirmationEmailSentAt) return;

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
        correlationId: `job:${job.id}`,
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
  },
  { connection: notificationConnection }
);

worker.on("failed", (job, err) => {
  console.error("notification job failed", job?.id, err);
});
