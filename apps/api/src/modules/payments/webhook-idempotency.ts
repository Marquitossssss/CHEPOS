import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

type RegisterProviderEventInput = {
  provider: string;
  providerEventId: string;
  payloadHash: string;
  orderId?: string;
};

export async function registerProviderEvent(input: RegisterProviderEventInput): Promise<{ isNew: boolean }> {
  try {
    await prisma.paymentProviderEvent.create({
      data: {
        provider: input.provider,
        providerEventId: input.providerEventId,
        payloadHash: input.payloadHash,
        orderId: input.orderId
      }
    });
    return { isNew: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await prisma.paymentProviderEvent.updateMany({
        where: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          status: "received"
        },
        data: {
          status: "deduped",
          processedAt: new Date()
        }
      });
      return { isNew: false };
    }
    throw error;
  }
}

export async function markProviderEventProcessed(provider: string, providerEventId: string, orderId?: string) {
  await prisma.paymentProviderEvent.updateMany({
    where: { provider, providerEventId },
    data: {
      status: "processed",
      processedAt: new Date(),
      ...(orderId ? { orderId } : {})
    }
  });
}

export async function markProviderEventError(provider: string, providerEventId: string, errorMessage: string) {
  await prisma.paymentProviderEvent.updateMany({
    where: { provider, providerEventId },
    data: {
      status: "error",
      processedAt: new Date(),
      errorMessage: errorMessage.slice(0, 1000)
    }
  });
}
