import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("domain event contract in critical flows", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../../..");
  const read = (rel: string) => fs.readFileSync(path.resolve(repoRoot, rel), "utf8");

  it("checkout/checkin flows emit required events", () => {
    const server = read("apps/api/src/server.ts");
    expect(server).toContain('type: "ORDER_RESERVED"');
    expect(server).toContain('type: "ORDER_PAID"');
    expect(server).toContain('type: "TICKETS_ISSUED"');
    expect(server).toContain('type: "TICKET_CHECKED_IN"');
  });

  it("email and expiration flows emit required events in transactions", () => {
    const worker = read("apps/api/src/workers/notificationsWorker.ts");
    const releaseJob = read("apps/api/src/jobs/releaseExpiredReservations.ts");

    expect(worker).toContain("prisma.$transaction");
    expect(worker).toContain('type: "ORDER_CONFIRMATION_EMAIL_SENT"');

    expect(releaseJob).toContain("prisma.$transaction");
    expect(releaseJob).toContain('type: "ORDER_EXPIRED"');
  });
});
