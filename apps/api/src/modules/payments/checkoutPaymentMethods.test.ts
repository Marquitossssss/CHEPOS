import { describe, expect, it, vi } from "vitest";
import { CheckoutPaymentMethodType } from "@prisma/client";
import { assertCheckoutPaymentMethodAllowed, getCheckoutPaymentMethodConfig } from "./checkoutPaymentMethods.js";

describe("checkout payment methods config", () => {
  it("returns default debit+credit when event has no explicit config", async () => {
    const db = {
      eventCheckoutPaymentMethod: {
        findMany: vi.fn().mockResolvedValue([])
      }
    } as any;

    await expect(getCheckoutPaymentMethodConfig(db, "evt-1")).resolves.toEqual({
      eventId: "evt-1",
      allowedMethodTypes: [CheckoutPaymentMethodType.debit_card, CheckoutPaymentMethodType.credit_card]
    });
  });

  it("returns only explicitly enabled methods when config exists", async () => {
    const db = {
      eventCheckoutPaymentMethod: {
        findMany: vi.fn().mockResolvedValue([{ methodType: CheckoutPaymentMethodType.credit_card }])
      }
    } as any;

    await expect(getCheckoutPaymentMethodConfig(db, "evt-1")).resolves.toEqual({
      eventId: "evt-1",
      allowedMethodTypes: [CheckoutPaymentMethodType.credit_card]
    });
  });

  it("rejects disabled method", async () => {
    const db = {
      eventCheckoutPaymentMethod: {
        findMany: vi.fn().mockResolvedValue([{ methodType: CheckoutPaymentMethodType.credit_card }])
      }
    } as any;

    await expect(assertCheckoutPaymentMethodAllowed(db, "evt-1", CheckoutPaymentMethodType.debit_card)).rejects.toMatchObject({
      code: "CHECKOUT_PAYMENT_METHOD_DISABLED",
      statusCode: 409
    });
  });
});
