import { z } from "zod";

export const opsDashboardQuerySchema = z.object({
  organizerId: z.string().uuid()
});

export type OpsDashboardQuery = z.infer<typeof opsDashboardQuerySchema>;
