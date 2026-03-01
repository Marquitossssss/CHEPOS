import type { FastifyInstance } from "fastify";
import { buildEventDashboard } from "./dashboard.service.js";
import { dashboardParamsSchema, dashboardQuerySchema } from "./dashboard.schemas.js";

type JwtPayload = { userId: string; email: string };

export function registerDashboardRoutes(app: FastifyInstance, verifyAuth: (req: any) => Promise<void>) {
  app.get("/api/events/:eventId/dashboard", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = dashboardParamsSchema.parse(req.params ?? {});
    const query = dashboardQuerySchema.parse(req.query ?? {});

    try {
      return await buildEventDashboard(user, params.eventId, query);
    } catch (error) {
      if (error instanceof Error && error.message === "NOT_FOUND") {
        throw app.httpErrors.notFound("Evento no encontrado");
      }
      if (error instanceof Error && error.message === "FORBIDDEN") {
        throw app.httpErrors.forbidden("Sin permisos para este organizador");
      }
      throw error;
    }
  });
}
