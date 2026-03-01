import "dotenv/config";
import { describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { fetchLatePaymentOutboxSummary } from "./latePaymentOutboxSummary.js";

describe("fetchLatePaymentOutboxSummary", () => {
  it("returns pending count + latest retry/error per case", async () => {
    const caseId = `00000000-0000-0000-0000-${Date.now().toString().slice(-12)}`;

    await prisma.domainEventOutbox.deleteMany({ where: { aggregateId: caseId } });

    const createdAtBase = new Date();
    await prisma.domainEventOutbox.createMany({
      data: [
        {
          eventName: "LATE_PAYMENT_CASE_CREATED",
          aggregateType: "LatePaymentCase",
          aggregateId: caseId,
          payload: { step: 1 },
          retryCount: 0,
          lastError: null,
          dispatchedAt: new Date(createdAtBase.getTime() + 1_000),
          createdAt: new Date(createdAtBase.getTime() - 1_000)
        },
        {
          eventName: "LATE_PAYMENT_CASE_RESOLVED",
          aggregateType: "LatePaymentCase",
          aggregateId: caseId,
          payload: { step: 2 },
          retryCount: 2,
          lastError: "worker timeout",
          dispatchedAt: null,
          createdAt: new Date(createdAtBase.getTime() + 1_000)
        }
      ]
    });

    const summary = await fetchLatePaymentOutboxSummary(prisma, [caseId]);

    expect(summary[caseId]).toEqual({
      pendingEvents: 1,
      lastRetryCount: 2,
      lastError: "worker timeout"
    });

    await prisma.domainEventOutbox.deleteMany({ where: { aggregateId: caseId } });
  });
});
