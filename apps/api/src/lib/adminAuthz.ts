import type { FastifyInstance } from "fastify";
import { hasAdminCapability, getOrganizerRoleCapabilities, type AdminAuthorizationContext, type AdminCapability, type OrganizerRole } from "@articket/shared";
import { prisma } from "./prisma.js";

type Role = OrganizerRole;

export async function getOrganizerAuthorizationContext(userId: string, organizerId: string): Promise<AdminAuthorizationContext | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId_organizerId: { userId, organizerId } },
    select: { role: true }
  });

  if (!membership) return null;

  return {
    scope: "organizer",
    organizerId,
    organizerRole: membership.role as Role,
    capabilities: getOrganizerRoleCapabilities(membership.role as Role)
  };
}

export function assertOrganizerCapability(app: FastifyInstance, context: AdminAuthorizationContext | null, capability: AdminCapability) {
  if (!context || !hasAdminCapability(context.organizerRole, capability)) {
    throw app.httpErrors.forbidden("Sin permisos para este organizador");
  }
  return context;
}

export async function requireOrganizerCapability(app: FastifyInstance, userId: string, organizerId: string, capability: AdminCapability) {
  const context = await getOrganizerAuthorizationContext(userId, organizerId);
  return assertOrganizerCapability(app, context, capability);
}

export async function requireEventCapability(app: FastifyInstance, userId: string, eventId: string, capability: AdminCapability) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, organizerId: true } });
  if (!event) throw app.httpErrors.notFound("Evento no encontrado");
  const context = await requireOrganizerCapability(app, userId, event.organizerId, capability);
  return {
    ...context,
    scope: "event" as const,
    eventId: event.id
  };
}
