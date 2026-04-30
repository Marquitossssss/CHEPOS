import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireEventCapability, requireOrganizerCapability } from "../../lib/adminAuthz.js";

type JwtPayload = { userId: string; email: string };
type VerifyAuth = (req: FastifyRequest) => Promise<void>;

const reasonSchema = z.string().trim().min(12).max(2000);
const locationSchema = z.record(z.any()).optional();
const venueTypeSchema = z.enum(["theater", "stadium", "arena", "club", "general_admission", "mixed"]);
const layoutModeSchema = z.enum(["seated", "ga", "mixed"]);
const schemaVersionValue = "venue-layout.v1";

const zoneSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.enum(["seated", "standing", "mixed"]),
  capacity: z.number().int().positive().optional(),
  geometry: z.record(z.any()).optional()
}).passthrough();

const seatSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  zoneId: z.string().trim().min(1),
  row: z.string().trim().min(1).optional(),
  number: z.string().trim().min(1).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  status: z.enum(["active", "disabled"]).optional()
}).passthrough();

const accessPointSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: z.enum(["gate", "door", "scanner"])
}).passthrough();

const posAreaSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1)
}).passthrough();

const layoutDataSchema = z.object({
  schemaVersion: z.literal(schemaVersionValue),
  canvas: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    unit: z.enum(["px", "m"])
  }).passthrough(),
  zones: z.array(zoneSchema),
  seats: z.array(seatSchema),
  accessPoints: z.array(accessPointSchema),
  posAreas: z.array(posAreaSchema)
}).passthrough();

function ensureUniqueIds(items: Array<{ id: string }>, collectionName: string) {
  const seen = new Set<string>();
  for (const item of items) {
    const id = item.id.trim();
    if (seen.has(id)) {
      throw new z.ZodError([{ code: "custom", path: [collectionName], message: `IDs duplicados en ${collectionName}` }]);
    }
    seen.add(id);
  }
}

function validateLayoutDataForMode(layoutData: z.infer<typeof layoutDataSchema>, layoutMode: z.infer<typeof layoutModeSchema>) {
  ensureUniqueIds(layoutData.zones, "zones");
  ensureUniqueIds(layoutData.seats, "seats");
  ensureUniqueIds(layoutData.accessPoints, "accessPoints");
  ensureUniqueIds(layoutData.posAreas, "posAreas");

  const zoneIds = new Set(layoutData.zones.map((zone) => zone.id));
  for (const seat of layoutData.seats) {
    if (!zoneIds.has(seat.zoneId)) {
      throw new z.ZodError([{ code: "custom", path: ["seats"], message: `seat.zoneId inexistente: ${seat.zoneId}` }]);
    }
  }

  const activeSeats = layoutData.seats.filter((seat) => seat.status !== "disabled");
  if (layoutMode === "seated" && activeSeats.length === 0) {
    throw new z.ZodError([{ code: "custom", path: ["seats"], message: "layoutMode seated requiere al menos un seat activo" }]);
  }
  if (layoutMode === "mixed" && layoutData.zones.length === 0) {
    throw new z.ZodError([{ code: "custom", path: ["zones"], message: "layoutMode mixed requiere al menos una zone" }]);
  }
}

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableNormalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stableNormalize(nested)])
    );
  }
  return value;
}

function hashJson(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(stableNormalize(value))).digest("hex");
}

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002";
}

function jsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return stableNormalize(value) as Prisma.InputJsonValue;
}

export async function registerVenueLayoutRoutes(app: FastifyInstance, deps: { verifyAuth: VerifyAuth }) {
  const { verifyAuth } = deps;

  app.post("/venues", { preHandler: verifyAuth }, async (req: any, reply) => {
    const user = req.user as JwtPayload;
    const body = z.object({
      organizerId: z.string().uuid(),
      name: z.string().trim().min(3).max(200),
      slug: z.string().trim().min(3).max(120).optional(),
      venueType: venueTypeSchema,
      location: locationSchema,
      reason: reasonSchema
    }).parse(req.body ?? {});

    await requireOrganizerCapability(app, user.userId, body.organizerId, "manageVenues");

    const slug = body.slug ?? slugify(body.name);
    if (!slug) throw app.httpErrors.badRequest("slug inválido");

    try {
      const venue = await prisma.$transaction(async (tx) => {
        const created = await tx.venue.create({
          data: {
            organizerId: body.organizerId,
            name: body.name,
            slug,
            venueType: body.venueType,
            ...(body.location ? { locationJson: toInputJson(body.location) } : {}),
            status: "active"
          }
        });

        await tx.auditLog.create({
          data: {
            organizerId: created.organizerId,
            actorUserId: user.userId,
            action: "venue_created",
            entityType: "venue",
            entityId: created.id,
            metadata: {
              organizerId: created.organizerId,
              venueId: created.id,
              reason: body.reason,
              correlationId: req.correlationId,
              before: null,
              after: {
                name: created.name,
                slug: created.slug,
                venueType: created.venueType,
                status: created.status
              }
            }
          }
        });

        return created;
      });

      reply.code(201);
      return {
        id: venue.id,
        organizerId: venue.organizerId,
        name: venue.name,
        slug: venue.slug,
        venueType: venue.venueType,
        status: venue.status,
        location: venue.locationJson,
        createdAt: venue.createdAt,
        updatedAt: venue.updatedAt
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw app.httpErrors.conflict("Venue slug ya existe en la organización");
      }
      throw error;
    }
  });

  app.get("/venues", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const query = z.object({ organizerId: z.string().uuid() }).parse(req.query ?? {});
    await requireOrganizerCapability(app, user.userId, query.organizerId, "viewVenues");

    const rows = await prisma.venue.findMany({
      where: { organizerId: query.organizerId },
      orderBy: [{ createdAt: "desc" }]
    });

    return rows.map((row) => ({
      id: row.id,
      organizerId: row.organizerId,
      name: row.name,
      slug: row.slug,
      venueType: row.venueType,
      status: row.status,
      location: row.locationJson,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  });

  app.get("/venues/:venueId", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = z.object({ venueId: z.string().uuid() }).parse(req.params ?? {});
    const venue = await prisma.venue.findUnique({ where: { id: params.venueId } });
    if (!venue) throw app.httpErrors.notFound("Venue no encontrado");
    await requireOrganizerCapability(app, user.userId, venue.organizerId, "viewVenues");

    return {
      id: venue.id,
      organizerId: venue.organizerId,
      name: venue.name,
      slug: venue.slug,
      venueType: venue.venueType,
      status: venue.status,
      location: venue.locationJson,
      createdAt: venue.createdAt,
      updatedAt: venue.updatedAt
    };
  });

  app.post("/venues/:venueId/layout-templates", { preHandler: verifyAuth }, async (req: any, reply) => {
    const user = req.user as JwtPayload;
    const params = z.object({ venueId: z.string().uuid() }).parse(req.params ?? {});
    const body = z.object({
      name: z.string().trim().min(3).max(200),
      description: z.string().trim().min(1).max(2000).optional(),
      layoutMode: layoutModeSchema,
      reason: reasonSchema
    }).parse(req.body ?? {});

    const venue = await prisma.venue.findUnique({ where: { id: params.venueId } });
    if (!venue) throw app.httpErrors.notFound("Venue no encontrado");
    await requireOrganizerCapability(app, user.userId, venue.organizerId, "manageVenueLayouts");

    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.venueLayoutTemplate.create({
        data: {
          venueId: venue.id,
          name: body.name,
          description: body.description,
          layoutMode: body.layoutMode,
          isActive: true
        }
      });

      await tx.auditLog.create({
        data: {
          organizerId: venue.organizerId,
          actorUserId: user.userId,
          action: "venue_layout_template_created",
          entityType: "venue_layout_template",
          entityId: created.id,
          metadata: {
            organizerId: venue.organizerId,
            venueId: venue.id,
            templateId: created.id,
            reason: body.reason,
            correlationId: req.correlationId,
            before: null,
            after: {
              name: created.name,
              layoutMode: created.layoutMode,
              isActive: created.isActive
            }
          }
        }
      });

      return created;
    });

    reply.code(201);
    return template;
  });

  app.get("/venues/:venueId/layout-templates", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = z.object({ venueId: z.string().uuid() }).parse(req.params ?? {});
    const venue = await prisma.venue.findUnique({ where: { id: params.venueId } });
    if (!venue) throw app.httpErrors.notFound("Venue no encontrado");
    await requireOrganizerCapability(app, user.userId, venue.organizerId, "viewVenueLayouts");

    return prisma.venueLayoutTemplate.findMany({
      where: { venueId: venue.id },
      orderBy: [{ createdAt: "desc" }]
    });
  });

  app.post("/layout-templates/:templateId/versions", { preHandler: verifyAuth }, async (req: any, reply) => {
    const user = req.user as JwtPayload;
    const params = z.object({ templateId: z.string().uuid() }).parse(req.params ?? {});
    const body = z.object({
      versionNumber: z.number().int().positive().optional(),
      schemaVersion: z.literal(schemaVersionValue),
      layoutData: layoutDataSchema,
      reason: reasonSchema
    }).parse(req.body ?? {});

    const template = await prisma.venueLayoutTemplate.findUnique({
      where: { id: params.templateId },
      include: { venue: true }
    });
    if (!template) throw app.httpErrors.notFound("Layout template no encontrado");
    await requireOrganizerCapability(app, user.userId, template.venue.organizerId, "manageVenueLayouts");
    validateLayoutDataForMode(body.layoutData, template.layoutMode as z.infer<typeof layoutModeSchema>);

    const layoutHash = hashJson(body.layoutData);

    try {
      const version = await prisma.$transaction(async (tx) => {
        const nextVersionNumber = body.versionNumber ?? (((await tx.venueLayoutVersion.aggregate({
          where: { templateId: template.id },
          _max: { versionNumber: true }
        }))._max.versionNumber ?? 0) + 1);

        const created = await tx.venueLayoutVersion.create({
          data: {
            templateId: template.id,
            versionNumber: nextVersionNumber,
            schemaVersion: body.schemaVersion,
            layoutData: toInputJson(body.layoutData),
            layoutHash,
            publishedAt: new Date(),
            createdByUserId: user.userId
          }
        });

        await tx.auditLog.create({
          data: {
            organizerId: template.venue.organizerId,
            actorUserId: user.userId,
            action: "venue_layout_version_created",
            entityType: "venue_layout_version",
            entityId: created.id,
            metadata: {
              organizerId: template.venue.organizerId,
              venueId: template.venueId,
              templateId: template.id,
              layoutVersionId: created.id,
              versionNumber: created.versionNumber,
              schemaVersion: created.schemaVersion,
              layoutHash: created.layoutHash,
              reason: body.reason,
              correlationId: req.correlationId,
              before: null,
              after: {
                publishedAt: created.publishedAt.toISOString()
              }
            }
          }
        });

        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

      reply.code(201);
      return version;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw app.httpErrors.conflict("versionNumber duplicado para el template");
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        throw app.httpErrors.conflict("No se pudo asignar versionNumber de forma segura");
      }
      throw error;
    }
  });

  app.get("/layout-templates/:templateId/versions", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = z.object({ templateId: z.string().uuid() }).parse(req.params ?? {});
    const template = await prisma.venueLayoutTemplate.findUnique({
      where: { id: params.templateId },
      include: { venue: true }
    });
    if (!template) throw app.httpErrors.notFound("Layout template no encontrado");
    await requireOrganizerCapability(app, user.userId, template.venue.organizerId, "viewVenueLayouts");

    return prisma.venueLayoutVersion.findMany({
      where: { templateId: template.id },
      orderBy: [{ versionNumber: "desc" }]
    });
  });

  app.post("/events/:eventId/layout-snapshot", { preHandler: verifyAuth }, async (req: any, reply) => {
    const user = req.user as JwtPayload;
    const params = z.object({ eventId: z.string().uuid() }).parse(req.params ?? {});
    const body = z.object({
      organizerId: z.string().uuid(),
      layoutVersionId: z.string().uuid(),
      reason: reasonSchema
    }).parse(req.body ?? {});

    await requireOrganizerCapability(app, user.userId, body.organizerId, "createEventLayoutSnapshot");

    const event = await prisma.event.findFirst({
      where: { id: params.eventId, organizerId: body.organizerId },
      select: { id: true, organizerId: true }
    });
    if (!event) throw app.httpErrors.notFound("Evento no encontrado");

    const scopedVersion = await prisma.venueLayoutVersion.findFirst({
      where: {
        id: body.layoutVersionId,
        publishedAt: { lte: new Date() },
        template: { venue: { organizerId: body.organizerId } }
      },
      include: {
        template: {
          include: {
            venue: true
          }
        }
      }
    }) as Prisma.VenueLayoutVersionGetPayload<{
      include: { template: { include: { venue: true } } }
    }> | null;
    if (!scopedVersion) throw app.httpErrors.notFound("Layout version no encontrada");

    const snapshotData = jsonRecord(scopedVersion.layoutData);
    const snapshotHash = hashJson(snapshotData);

    try {
      const snapshot = await prisma.$transaction(async (tx) => {
        const created = await tx.eventLayoutSnapshot.create({
          data: {
            eventId: event.id,
            venueId: scopedVersion.template.venueId,
            templateId: scopedVersion.templateId,
            layoutVersionId: scopedVersion.id,
            snapshotData: toInputJson(snapshotData),
            snapshotHash,
            createdByUserId: user.userId
          }
        });

        await tx.auditLog.create({
          data: {
            organizerId: body.organizerId,
            actorUserId: user.userId,
            action: "event_layout_snapshot_created",
            entityType: "event_layout_snapshot",
            entityId: created.id,
            metadata: {
              organizerId: body.organizerId,
              venueId: created.venueId,
              templateId: created.templateId,
              layoutVersionId: created.layoutVersionId,
              eventId: created.eventId,
              versionNumber: scopedVersion.versionNumber,
              schemaVersion: scopedVersion.schemaVersion,
              layoutHash: scopedVersion.layoutHash,
              snapshotHash: created.snapshotHash,
              reason: body.reason,
              correlationId: req.correlationId,
              before: null,
              after: {
                createdAt: created.createdAt.toISOString()
              }
            }
          }
        });

        return created;
      });

      reply.code(201);
      return snapshot;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw app.httpErrors.conflict("El evento ya tiene layout snapshot");
      }
      throw error;
    }
  });

  app.get("/events/:eventId/layout-snapshot", { preHandler: verifyAuth }, async (req: any) => {
    const user = req.user as JwtPayload;
    const params = z.object({ eventId: z.string().uuid() }).parse(req.params ?? {});
    await requireEventCapability(app, user.userId, params.eventId, "viewEventLayoutSnapshot");

    const snapshot = await prisma.eventLayoutSnapshot.findUnique({
      where: { eventId: params.eventId }
    });
    if (!snapshot) throw app.httpErrors.notFound("Layout snapshot no encontrado");
    return snapshot;
  });
}
