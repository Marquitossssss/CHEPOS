import { z } from "zod";

export * from "./adminAuthz.js";

export const reserveSchema = z.object({
  clientRequestId: z.string().min(1, "clientRequestId es obligatorio"),
  organizerId: z.string().uuid(),
  eventId: z.string().uuid(),
  customerEmail: z.string().email(),
  items: z.array(z.object({ ticketTypeId: z.string().uuid(), quantity: z.number().int().positive() })).min(1)
});

export const confirmSchema = z.object({
  clientRequestId: z.string().min(1, "clientRequestId es obligatorio"),
  orderId: z.string().uuid(),
  paymentReference: z.string().min(3)
});

export type ReserveInput = z.infer<typeof reserveSchema>;
export type ConfirmInput = z.infer<typeof confirmSchema>;
