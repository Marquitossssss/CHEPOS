import { z } from "zod";

export * from "./adminAuthz.js";
export * from "./organizerMembers.js";
export * from "./organizerInvitations.js";

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

export const artistStatusSchema = z.enum(["active", "inactive"]);

export const createArtistSchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  legalOrFullName: z.string().min(1).optional(),
  shortBio: z.string().min(1).optional(),
  profileImageUrl: z.string().url().optional(),
  genreTagsJson: z.array(z.string().min(1)).optional(),
  externalLinksJson: z.array(z.object({
    platform: z.string().min(1),
    url: z.string().url()
  })).optional(),
  status: artistStatusSchema.optional()
});

export const updateArtistSchema = z.object({
  slug: z.string().min(1),
  displayName: z.string().min(1),
  legalOrFullName: z.string().min(1).nullable().optional(),
  shortBio: z.string().min(1).nullable().optional(),
  profileImageUrl: z.string().url().nullable().optional(),
  genreTagsJson: z.array(z.string().min(1)).nullable().optional(),
  externalLinksJson: z.array(z.object({
    platform: z.string().min(1),
    url: z.string().url()
  })).nullable().optional(),
  status: artistStatusSchema.optional()
});

export const artistListQuerySchema = z.object({
  status: artistStatusSchema.optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const artistEventsListQuerySchema = z.object({
  upcoming: z.coerce.boolean().optional()
});

export const artistResponseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  displayName: z.string(),
  legalOrFullName: z.string().nullable(),
  shortBio: z.string().nullable(),
  profileImageUrl: z.string().nullable(),
  genreTagsJson: z.array(z.string()).nullable(),
  externalLinksJson: z.array(z.object({
    platform: z.string(),
    url: z.string().url()
  })).nullable(),
  status: artistStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const eventArtistLinkCreateSchema = z.object({
  artistId: z.string().uuid(),
  billingOrder: z.number().int().optional(),
  billingLabel: z.string().min(1).optional(),
  isPrimary: z.boolean().optional()
});

export const eventArtistUpdateSchema = z.object({
  billingOrder: z.number().int().nullable().optional(),
  billingLabel: z.string().min(1).nullable().optional(),
  isPrimary: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, {
  message: "At least one field must be provided"
});

export const eventArtistResponseSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  artistId: z.string().uuid(),
  billingOrder: z.number().int().nullable(),
  billingLabel: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  artist: artistResponseSchema
});

export const eventArtistListResponseSchema = z.object({
  eventId: z.string().uuid(),
  artists: z.array(eventArtistResponseSchema)
});

export const artistEventResponseSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  artistId: z.string().uuid(),
  billingOrder: z.number().int().nullable(),
  billingLabel: z.string().nullable(),
  isPrimary: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  event: z.object({
    id: z.string().uuid(),
    organizerId: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    visibility: z.enum(["draft", "published", "hidden"]),
    capacity: z.number().int()
  })
});

export const artistEventListResponseSchema = z.object({
  artistId: z.string().uuid(),
  events: z.array(artistEventResponseSchema)
});

export type ReserveInput = z.infer<typeof reserveSchema>;
export type ConfirmInput = z.infer<typeof confirmSchema>;
export type ArtistStatusInput = z.infer<typeof artistStatusSchema>;
export type CreateArtistInput = z.infer<typeof createArtistSchema>;
export type UpdateArtistInput = z.infer<typeof updateArtistSchema>;
export type ArtistListQueryInput = z.infer<typeof artistListQuerySchema>;
export type ArtistEventsListQueryInput = z.infer<typeof artistEventsListQuerySchema>;
export type ArtistResponse = z.infer<typeof artistResponseSchema>;
export type EventArtistLinkCreateInput = z.infer<typeof eventArtistLinkCreateSchema>;
export type EventArtistUpdateInput = z.infer<typeof eventArtistUpdateSchema>;
export type EventArtistResponse = z.infer<typeof eventArtistResponseSchema>;
export type EventArtistListResponse = z.infer<typeof eventArtistListResponseSchema>;
export type ArtistEventResponse = z.infer<typeof artistEventResponseSchema>;
export type ArtistEventListResponse = z.infer<typeof artistEventListResponseSchema>;
