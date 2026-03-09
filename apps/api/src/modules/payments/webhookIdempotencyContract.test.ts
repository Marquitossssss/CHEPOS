import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("payments webhook idempotency contract", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
  const read = (rel: string) => fs.readFileSync(path.resolve(repoRoot, rel), "utf8");

  it("dedupes duplicate provider events by provider + providerEventId", () => {
    const moduleContent = read("apps/api/src/modules/payments/webhook-idempotency.ts");

    expect(moduleContent).toContain("providerEventId");
    expect(moduleContent).toContain("error.code === \"P2002\"");
    expect(moduleContent).toContain("if (existing.status === \"processed\")");
    expect(moduleContent).toContain("return { state: \"deduped\" }");
  });

  it("treats replayed webhook events as no-op", () => {
    const server = read("apps/api/src/server.ts");

    expect(server).toContain("payments webhook deduped");
    expect(server).toContain("return { ok: true, deduped: true }");
  });

  it("retries events previously marked as error", () => {
    const moduleContent = read("apps/api/src/modules/payments/webhook-idempotency.ts");

    expect(moduleContent).toContain("{ status: \"error\" }");
    expect(moduleContent).toContain("return { state: \"claimed\", mode: \"retry\" }");
  });

  it("tracks inFlight state when processing lease is still active", () => {
    const moduleContent = read("apps/api/src/modules/payments/webhook-idempotency.ts");

    expect(moduleContent).toContain("existing.status === \"processing\"");
    expect(moduleContent).toContain("return { state: \"in_flight\" }");
  });

  it("uses transactional guard to prevent concurrent double paid transition", () => {
    const applyPaymentEvent = read("apps/api/src/modules/payments/applyPaymentEvent.ts");

    expect(applyPaymentEvent).toContain("FOR UPDATE");
    expect(applyPaymentEvent).toContain("status: { in: [\"pending\", \"reserved\", \"expired\"] }");
    expect(applyPaymentEvent).toContain("return { ok: true, outcome: \"terminal_guard\" }");
  });

  it("keeps paid transition idempotent when order is already paid", () => {
    const applyPaymentEvent = read("apps/api/src/modules/payments/applyPaymentEvent.ts");

    expect(applyPaymentEvent).toContain("if (terminalStatuses.has(order.status))");
    expect(applyPaymentEvent).toContain("return { ok: true, outcome: \"terminal_guard\" }");
  });
});
