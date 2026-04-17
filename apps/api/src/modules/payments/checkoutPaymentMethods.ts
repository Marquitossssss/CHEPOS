import { CheckoutPaymentMethodType, PrismaClient } from "@prisma/client";

const DEFAULT_CHECKOUT_PAYMENT_METHODS: CheckoutPaymentMethodType[] = [
  CheckoutPaymentMethodType.debit_card,
  CheckoutPaymentMethodType.credit_card
];

export type CheckoutPaymentMethodConfig = {
  eventId: string;
  allowedMethodTypes: CheckoutPaymentMethodType[];
};

export async function getCheckoutPaymentMethodConfig(
  db: Pick<PrismaClient, "eventCheckoutPaymentMethod">,
  eventId: string
): Promise<CheckoutPaymentMethodConfig> {
  const rows = await db.eventCheckoutPaymentMethod.findMany({
    where: { eventId, enabled: true },
    orderBy: { methodType: "asc" },
    select: { methodType: true }
  });

  return {
    eventId,
    allowedMethodTypes: rows.length > 0 ? rows.map((row) => row.methodType) : [...DEFAULT_CHECKOUT_PAYMENT_METHODS]
  };
}

export async function assertCheckoutPaymentMethodAllowed(
  db: Pick<PrismaClient, "eventCheckoutPaymentMethod">,
  eventId: string,
  paymentMethodType: CheckoutPaymentMethodType
) {
  const config = await getCheckoutPaymentMethodConfig(db, eventId);
  if (config.allowedMethodTypes.includes(paymentMethodType)) return config;

  const error: Error & { statusCode?: number; code?: string } = new Error("Payment method not enabled for event");
  error.statusCode = 409;
  error.code = "CHECKOUT_PAYMENT_METHOD_DISABLED";
  throw error;
}
