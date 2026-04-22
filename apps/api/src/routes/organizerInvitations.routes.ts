import type { FastifyInstance, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { z } from "zod";
import {
  organizerInvitationAcceptInputSchema,
  organizerInvitationAcceptResultSchema,
  organizerInvitationCreateInputSchema,
  organizerInvitationCreateResultSchema,
  organizerInvitationRevokeResultSchema,
  organizerInvitationResendResultSchema,
  organizerInvitationsListSchema,
  type OrganizerInvitationListItem
} from "@articket/shared";
import { prisma } from "../lib/prisma.js";

type JwtPayload = { userId: string; email: string };

type VerifyAuth = (req: FastifyRequest) => Promise<void>;

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function canonicalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function generateInvitationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashInvitationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function registerOrganizerInvitationRoutes(app: FastifyInstance, deps: { verifyAuth: VerifyAuth }) {
  const { verifyAuth } = deps;

  app.get("/organizers/:id/invitations", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const actorMembership = await prisma.membership.findUnique({
      where: { userId_organizerId: { userId: user.userId, organizerId: params.id } },
      select: { role: true }
    });

    if (!actorMembership || actorMembership.role !== "owner") {
      throw app.httpErrors.forbidden("Solo owner puede listar invitaciones de la organización");
    }

    const rows = await prisma.organizerInvitation.findMany({
      where: { organizerId: params.id },
      orderBy: [{ createdAt: "desc" }]
    });

    const dto: OrganizerInvitationListItem[] = rows.map((row) => ({
      invitationId: row.id,
      organizerId: row.organizerId,
      email: row.email,
      role: row.role as "admin" | "staff" | "scanner",
      status: row.status as "pending" | "accepted" | "revoked",
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      createdByUserId: row.createdByUserId,
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      acceptedByUserId: row.acceptedByUserId ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokedByUserId: row.revokedByUserId ?? null,
      membershipId: row.membershipId ?? null
    }));

    return organizerInvitationsListSchema.parse(dto);
  });

  app.post("/organizers/:id/invitations", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = organizerInvitationCreateInputSchema.parse(req.body ?? {});

    const actorMembership = await prisma.membership.findUnique({
      where: { userId_organizerId: { userId: user.userId, organizerId: params.id } },
      select: { role: true }
    });

    if (!actorMembership || actorMembership.role !== "owner") {
      throw app.httpErrors.forbidden("Solo owner puede crear invitaciones de la organización");
    }

    const emailCanonical = canonicalizeEmail(body.email);
    const targetUser = await prisma.user.findFirst({
      where: { email: { equals: emailCanonical, mode: "insensitive" } },
      select: { id: true }
    });

    if (targetUser) {
      const existingMembership = await prisma.membership.findUnique({
        where: { userId_organizerId: { userId: targetUser.id, organizerId: params.id } },
        select: { id: true }
      });

      if (existingMembership) {
        throw app.httpErrors.conflict("El usuario ya pertenece a la organización");
      }
    }

    const inviteToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(inviteToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const invitation = await tx.organizerInvitation.create({
          data: {
            organizerId: params.id,
            email: body.email,
            emailCanonical,
            role: body.role,
            status: "pending",
            tokenHash,
            expiresAt,
            createdByUserId: user.userId
          }
        });

        const audit = await tx.auditLog.create({
          data: {
            organizerId: params.id,
            actorUserId: user.userId,
            action: "membership.invitation_created",
            entityType: "organizer_invitation",
            entityId: invitation.id,
            metadata: {
              email: invitation.email,
              emailCanonical: invitation.emailCanonical,
              role: invitation.role,
              expiresAt: invitation.expiresAt.toISOString()
            }
          }
        });

        return organizerInvitationCreateResultSchema.parse({
          invitationId: invitation.id,
          organizerId: invitation.organizerId,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt.toISOString(),
          inviteToken,
          auditLogId: audit.id
        });
      });

      return result;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw app.httpErrors.conflict("Ya existe una invitación pendiente para ese email en la organización");
      }
      throw error;
    }
  });

  app.post("/organizers/:id/invitations/:invitationId/resend", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = z.object({ id: z.string().uuid(), invitationId: z.string().uuid() }).parse(req.params);

    const actorMembership = await prisma.membership.findUnique({
      where: { userId_organizerId: { userId: user.userId, organizerId: params.id } },
      select: { role: true }
    });

    if (!actorMembership || actorMembership.role !== "owner") {
      throw app.httpErrors.forbidden("Solo owner puede reenviar invitaciones de la organización");
    }

    const current = await prisma.organizerInvitation.findUnique({ where: { id: params.invitationId } });
    if (!current || current.organizerId !== params.id) {
      throw app.httpErrors.notFound("Invitation no encontrada");
    }
    if (current.status !== "pending") {
      throw app.httpErrors.conflict("La invitación no está pending");
    }

    const inviteToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(inviteToken);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    try {
      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.organizerInvitation.update({
          where: { id: current.id },
          data: { tokenHash, expiresAt }
        });

        const audit = await tx.auditLog.create({
          data: {
            organizerId: params.id,
            actorUserId: user.userId,
            action: "membership.invitation_token_rotated",
            entityType: "organizer_invitation",
            entityId: updated.id,
            metadata: {
              email: updated.email,
              emailCanonical: updated.emailCanonical,
              role: updated.role,
              expiresAt: updated.expiresAt.toISOString()
            }
          }
        });

        return organizerInvitationResendResultSchema.parse({
          invitationId: updated.id,
          organizerId: updated.organizerId,
          email: updated.email,
          role: updated.role,
          status: updated.status,
          expiresAt: updated.expiresAt.toISOString(),
          inviteToken,
          auditLogId: audit.id
        });
      });

      return result;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw app.httpErrors.conflict("No se pudo rotar el token de invitación");
      }
      throw error;
    }
  });

  app.post("/organizers/:id/invitations/:invitationId/revoke", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = z.object({ id: z.string().uuid(), invitationId: z.string().uuid() }).parse(req.params);

    const actorMembership = await prisma.membership.findUnique({
      where: { userId_organizerId: { userId: user.userId, organizerId: params.id } },
      select: { role: true }
    });

    if (!actorMembership || actorMembership.role !== "owner") {
      throw app.httpErrors.forbidden("Solo owner puede revocar invitaciones de la organización");
    }

    const current = await prisma.organizerInvitation.findUnique({
      where: { id: params.invitationId },
      select: {
        id: true,
        organizerId: true,
        email: true,
        emailCanonical: true,
        role: true,
        status: true,
        expiresAt: true
      }
    });

    if (!current || current.organizerId !== params.id) {
      throw app.httpErrors.notFound("Invitation no encontrada");
    }

    if (current.status !== "pending") {
      throw app.httpErrors.conflict("La invitación no está pending");
    }

    if (current.expiresAt.getTime() <= Date.now()) {
      throw app.httpErrors.conflict("La invitación está vencida");
    }

    const revokedAt = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.organizerInvitation.updateMany({
        where: {
          id: current.id,
          organizerId: params.id,
          status: "pending",
          expiresAt: { gt: revokedAt }
        },
        data: {
          status: "revoked",
          revokedAt,
          revokedByUserId: user.userId
        }
      });

      if (claimed.count !== 1) {
        throw app.httpErrors.conflict("La invitación ya fue resuelta por otra operación");
      }

      const updated = await tx.organizerInvitation.findUnique({
        where: { id: current.id },
        select: { id: true, organizerId: true, revokedAt: true }
      });

      const audit = await tx.auditLog.create({
        data: {
          organizerId: params.id,
          actorUserId: user.userId,
          action: "membership.invitation_revoked",
          entityType: "organizer_invitation",
          entityId: current.id,
          metadata: {
            email: current.email,
            emailCanonical: current.emailCanonical,
            role: current.role,
            revokedAt: revokedAt.toISOString()
          }
        }
      });

      return organizerInvitationRevokeResultSchema.parse({
        invitationId: current.id,
        organizerId: current.organizerId,
        status: "revoked",
        revokedAt: (updated?.revokedAt ?? revokedAt).toISOString(),
        auditLogId: audit.id
      });
    });

    return result;
  });

  app.post("/organizers/invitations/accept", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const body = organizerInvitationAcceptInputSchema.parse(req.body ?? {});
    const tokenHash = hashInvitationToken(body.token);

    const invitation = await prisma.organizerInvitation.findFirst({
      where: { tokenHash },
      select: {
        id: true,
        organizerId: true,
        email: true,
        emailCanonical: true,
        role: true,
        status: true,
        expiresAt: true
      }
    });

    if (!invitation) {
      throw app.httpErrors.notFound("Invitation no encontrada");
    }

    const authUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, email: true }
    });

    if (!authUser) {
      throw app.httpErrors.unauthorized("Usuario autenticado no encontrado");
    }

    if (canonicalizeEmail(authUser.email) !== invitation.emailCanonical) {
      throw app.httpErrors.conflict("El email autenticado no coincide con la invitación");
    }

    if (invitation.status !== "pending") {
      throw app.httpErrors.conflict("La invitación no está pending");
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw app.httpErrors.conflict("La invitación está vencida");
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const claimed = await tx.organizerInvitation.updateMany({
          where: {
            id: invitation.id,
            tokenHash,
            status: "pending",
            expiresAt: { gt: new Date() }
          },
          data: {
            status: "accepted",
            acceptedAt: new Date(),
            acceptedByUserId: authUser.id
          }
        });

        if (claimed.count !== 1) {
          throw app.httpErrors.conflict("La invitación ya fue resuelta por otra operación");
        }

        const membership = await tx.membership.create({
          data: {
            organizerId: invitation.organizerId,
            userId: authUser.id,
            role: invitation.role
          }
        });

        await tx.organizerInvitation.update({
          where: { id: invitation.id },
          data: { membershipId: membership.id }
        });

        const audit = await tx.auditLog.create({
          data: {
            organizerId: invitation.organizerId,
            actorUserId: authUser.id,
            action: "membership.invitation_accepted",
            entityType: "organizer_invitation",
            entityId: invitation.id,
            metadata: {
              email: invitation.email,
              emailCanonical: invitation.emailCanonical,
              role: invitation.role,
              membershipId: membership.id,
              userId: authUser.id
            }
          }
        });

        return organizerInvitationAcceptResultSchema.parse({
          invitationId: invitation.id,
          membershipId: membership.id,
          organizerId: invitation.organizerId,
          userId: authUser.id,
          email: invitation.email,
          role: invitation.role,
          auditLogId: audit.id
        });
      });

      return result;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw app.httpErrors.conflict("El usuario ya pertenece a la organización");
      }
      throw error;
    }
  });
}
