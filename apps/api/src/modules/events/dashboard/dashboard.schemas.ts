import { z } from "zod";

export const dashboardParamsSchema = z.object({
  eventId: z.string().uuid()
});

export const dashboardQuerySchema = z.object({
  range: z.enum(["24h", "7d", "30d", "90d"]).default("7d"),
  bucket: z.enum(["hour", "day"]).default("day")
});

export type DashboardParams = z.infer<typeof dashboardParamsSchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
