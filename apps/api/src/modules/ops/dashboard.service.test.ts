import { describe, expect, it } from "vitest";
import { buildOpsDashboard } from "./dashboard.service.js";

describe("buildOpsDashboard", () => {
  it("returns valid empty-safe structure", async () => {
    const db: any = {
      membership: {
        findUnique: async () => ({ role: "owner" })
      },
      order: {
        groupBy: async () => []
      },
      latePaymentCase: {
        count: async () => 0
      },
      inventoryReservation: {
        count: async () => 0
      },
      domainEvent: {
        findMany: async () => []
      }
    };

    const result = await buildOpsDashboard({ userId: "u1", email: "x@test" }, "11111111-1111-1111-1111-111111111111", db);

    expect(result).toEqual({
      window24h: {
        ordersTotal: 0,
        paid: 0,
        pending: 0,
        expired: 0,
        grossAmount: 0,
        netAmount: 0
      },
      window7d: {
        ordersTotal: 0,
        paid: 0,
        grossAmount: 0,
        netAmount: 0
      },
      risk: {
        latePaymentCases: 0,
        reservationsExpiringSoon: 0
      },
      activity: []
    });
  });
});
