import { z } from "zod";

export const opsDashboardParamsSchema = z.object({
  organizerId: z.string().uuid()
});

export const opsDashboardQuerySchema = z.object({}).passthrough();

export type OpsDashboardParams = z.infer<typeof opsDashboardParamsSchema>;
export type OpsDashboardQuery = z.infer<typeof opsDashboardQuerySchema>;
