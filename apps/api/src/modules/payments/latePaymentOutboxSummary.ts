import { Prisma, type PrismaClient } from "@prisma/client";

export type LatePaymentOutboxSummary = {
  pendingEvents: number;
  lastRetryCount: number;
  lastError: string | null;
};

type OutboxSummaryRow = {
  caseId: string;
  pendingEvents: number;
  lastRetryCount: number | null;
  lastError: string | null;
};

/**
 * lastRetryCount/lastError use the latest outbox row by createdAt DESC, id DESC for each case.
 */
export async function fetchLatePaymentOutboxSummary(
  db: PrismaClient | Prisma.TransactionClient,
  caseIds: string[]
): Promise<Record<string, LatePaymentOutboxSummary>> {
  if (caseIds.length === 0) return {};

  const rows = await db.$queryRaw<OutboxSummaryRow[]>(Prisma.sql`
    SELECT
      "aggregateId" AS "caseId",
      COUNT(*) FILTER (WHERE "dispatchedAt" IS NULL)::int AS "pendingEvents",
      (ARRAY_AGG("retryCount" ORDER BY "createdAt" DESC, "id" DESC))[1]::int AS "lastRetryCount",
      (ARRAY_AGG("lastError" ORDER BY "createdAt" DESC, "id" DESC))[1] AS "lastError"
    FROM "DomainEventOutbox"
    WHERE "aggregateType" = 'LatePaymentCase'
      AND "aggregateId" IN (${Prisma.join(caseIds)})
    GROUP BY "aggregateId"
  `);

  const byCase = new Map(rows.map((row) => [row.caseId, row]));

  return caseIds.reduce<Record<string, LatePaymentOutboxSummary>>((acc, caseId) => {
    const row = byCase.get(caseId);
    acc[caseId] = {
      pendingEvents: row?.pendingEvents ?? 0,
      lastRetryCount: row?.lastRetryCount ?? 0,
      lastError: row?.lastError ?? null
    };
    return acc;
  }, {});
}
