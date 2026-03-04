import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";

const tx: any = {
  paymentEvent: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  $queryRaw: vi.fn(),
  order: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn()
  },
  orderItem: { aggregate: vi.fn() },
  inventoryReservation: { aggregate: vi.fn(), updateMany: vi.fn() },
  ticketType: { findUniqueOrThrow: vi.fn() },
  ticket: { createMany: vi.fn() }
};

const prismaMock = {
  $transaction: vi.fn(async (cb: any) => cb(tx))
};

const emitDomainEventMock = vi.fn(async () => undefined);

vi.mock("../../lib/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../../lib/domainEvents.js", () => ({ emitDomainEvent: emitDomainEventMock }));

describe("applyPaymentEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no-op when event already processed", async () => {
    tx.paymentEvent.findUnique.mockResolvedValueOnce({ id: "e1", processedAt: new Date(), orderId: "o1" });

    const { applyPaymentEvent } = await import("./applyPaymentEvent.js");
    const result = await applyPaymentEvent("e1", "corr-1");

    expect(result.outcome).toBe("already_processed");
  });

  it("marks unmatched when orderId is null", async () => {
    tx.paymentEvent.findUnique.mockResolvedValueOnce({ id: "e2", processedAt: null, orderId: null });

    const { applyPaymentEvent } = await import("./applyPaymentEvent.js");
    const result = await applyPaymentEvent("e2", "corr-2");

    expect(result.outcome).toBe("unmatched");
    expect(tx.paymentEvent.update).toHaveBeenCalled();
  });

  it("applies terminal guard when order already terminal", async () => {
    tx.paymentEvent.findUnique.mockResolvedValueOnce({ id: "e3", processedAt: null, orderId: "o3", eventType: "payment.failed", provider: "mock" });
    tx.order.findUnique.mockResolvedValueOnce({
      id: "o3",
      status: "paid",
      organizerId: "org",
      eventId: "evt",
      items: [],
      reservations: [],
      tickets: []
    });

    const { applyPaymentEvent } = await import("./applyPaymentEvent.js");
    const result = await applyPaymentEvent("e3", "corr-3");

    expect(result.outcome).toBe("terminal_guard");
    expect(tx.paymentEvent.update).toHaveBeenCalled();
  });

  it("maps failed eventType to FAILED transition", async () => {
    tx.paymentEvent.findUnique.mockResolvedValueOnce({ id: "e4", processedAt: null, orderId: "o4", eventType: "payment.failed", provider: "mock" });
    tx.order.findUnique.mockResolvedValueOnce({
      id: "o4",
      status: "pending",
      organizerId: "org",
      eventId: "evt",
      items: [],
      reservations: [],
      tickets: []
    });
    tx.order.updateMany.mockResolvedValueOnce({ count: 1 });

    const { applyPaymentEvent } = await import("./applyPaymentEvent.js");
    const result = await applyPaymentEvent("e4", "corr-4");

    expect(result.outcome).toBe("failed");
    expect(tx.order.updateMany).toHaveBeenCalled();
    expect(emitDomainEventMock).toHaveBeenCalled();
  });

  it("sets PAID_NO_STOCK when paid arrives after expiration without stock", async () => {
    tx.paymentEvent.findUnique.mockResolvedValueOnce({ id: "e5", processedAt: null, orderId: "o5", eventType: "payment.succeeded", provider: "mock" });
    tx.order.findUnique.mockResolvedValueOnce({
      id: "o5",
      status: "reserved",
      organizerId: "org",
      eventId: "evt",
      reservedUntil: new Date(Date.now() - 60_000),
      items: [{ ticketTypeId: "tt1", quantity: 2 }],
      reservations: [],
      tickets: []
    });
    tx.ticketType.findUniqueOrThrow.mockResolvedValueOnce({ id: "tt1", quota: 1 });
    tx.orderItem.aggregate.mockResolvedValueOnce({ _sum: { quantity: 0 } });
    tx.inventoryReservation.aggregate.mockResolvedValueOnce({ _sum: { quantity: 0 } });

    const { applyPaymentEvent } = await import("./applyPaymentEvent.js");
    const result = await applyPaymentEvent("e5", "corr-5");

    expect(result.outcome).toBe("paid_no_stock");
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: "o5" }, data: { status: "paid_no_stock" } });
  });

  it("is idempotent when same event is processed twice", async () => {
    tx.paymentEvent.findUnique
      .mockResolvedValueOnce({ id: "e6", processedAt: null, orderId: "o6", eventType: "payment.succeeded", provider: "mock", providerPaymentId: "p6" })
      .mockResolvedValueOnce({ id: "e6", processedAt: new Date(), orderId: "o6", eventType: "payment.succeeded", provider: "mock", providerPaymentId: "p6" });
    tx.order.findUnique.mockResolvedValueOnce({
      id: "o6",
      status: "reserved",
      organizerId: "org",
      eventId: "evt",
      reservedUntil: new Date(Date.now() + 60_000),
      items: [],
      reservations: [],
      tickets: []
    });
    tx.order.updateMany.mockResolvedValueOnce({ count: 1 });

    const { applyPaymentEvent } = await import("./applyPaymentEvent.js");
    const first = await applyPaymentEvent("e6", "corr-6");
    const second = await applyPaymentEvent("e6", "corr-6");

    expect(first.outcome).toBe("paid");
    expect(second.outcome).toBe("already_processed");
  });
});
