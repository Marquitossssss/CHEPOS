import type { FastifyInstance } from "fastify";
import { buildOpsDashboard } from "./dashboard.service.js";
import { opsDashboardParamsSchema, opsDashboardQuerySchema } from "./dashboard.schemas.js";

type JwtPayload = { userId: string; email: string };

export function registerOpsDashboardRoutes(app: FastifyInstance, verifyAuth: (req: any) => Promise<void>) {
  app.get("/organizers/:organizerId/ops/dashboard", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = opsDashboardParamsSchema.parse(req.params ?? {});
    opsDashboardQuerySchema.parse(req.query ?? {});

    try {
      return await buildOpsDashboard(user, params.organizerId);
    } catch (error) {
      if (error instanceof Error && error.message === "FORBIDDEN") {
        throw app.httpErrors.forbidden("Sin permisos para este organizador");
      }
      throw error;
    }
  });
}
