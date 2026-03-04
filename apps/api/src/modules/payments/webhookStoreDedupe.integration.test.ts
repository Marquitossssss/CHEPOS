import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";

if (!process.env.API_PORT) process.env.API_PORT = "3410";
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

const hasDb = Boolean(process.env.DATABASE_URL);
const baseUrl = `http://127.0.0.1:${process.env.API_PORT}`;
const provider = "test-provider";

async function waitForHealth() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy in time");
}

describe.skipIf(!hasDb)("payment webhook store + dedupe", () => {
  beforeAll(async () => {
    await import("../../server.js");
    await waitForHealth();
  });

  afterAll(async () => {
    await prisma.paymentEvent.deleteMany({ where: { provider } });
  });

  it("dedupes same webhook 20 times and always returns 200", async () => {
    const eventId = `evt-${Date.now()}`;
    const payload = {
      id: eventId,
      type: "payment.updated",
      data: {
        id: `pay-${Date.now()}`,
        metadata: { orderId: "not-a-uuid" }
      }
    };

    const responses = await Promise.all(
      Array.from({ length: 20 }).map(() =>
        fetch(`${baseUrl}/webhooks/payments/${provider}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        })
      )
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);

    const responseBodies = await Promise.all(responses.map((r) => r.json()));
    const dedupedCount = responseBodies.filter((b) => b?.deduped === true).length;
    const storedCount = responseBodies.filter((b) => b?.deduped === false).length;

    expect(storedCount).toBe(1);
    expect(dedupedCount).toBe(19);

    const rows = await prisma.paymentEvent.findMany({
      where: { provider, providerEventId: eventId }
    });

    expect(rows.length).toBe(1);
  });

  it("rejects missing event id with 400", async () => {
    const response = await fetch(`${baseUrl}/webhooks/payments/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "payment.updated", data: { id: "pay-x" } })
    });

    expect(response.status).toBe(400);
  });

  it("stores row with orderId null when metadata orderId is invalid uuid", async () => {
    const eventId = `evt-invalid-order-${Date.now()}`;
    const payload = {
      id: eventId,
      type: "payment.updated",
      data: {
        id: `pay-invalid-${Date.now()}`,
        metadata: { orderId: "xxx" }
      }
    };

    const response = await fetch(`${baseUrl}/webhooks/payments/${provider}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);

    const row = await prisma.paymentEvent.findFirst({
      where: { provider, providerEventId: eventId }
    });

    expect(row).toBeTruthy();
    expect(row?.orderId).toBeNull();
  });
});
