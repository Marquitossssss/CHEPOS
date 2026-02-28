import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export async function ensureNotReplay(provider: string, externalEventId: string): Promise<boolean> {
  try {
    await prisma.processedWebhookEvent.create({
      data: {
        provider,
        externalEventId
      }
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return false;
    }
    throw error;
  }
}
