import type { prisma as prismaClient } from "../../lib/prisma.js";
import type {
  ArtistEventListResponse,
  ArtistEventsListQueryInput,
  ArtistListQueryInput,
  ArtistResponse,
  CreateArtistInput,
  EventArtistLinkCreateInput,
  EventArtistListResponse,
  EventArtistResponse,
  EventArtistUpdateInput,
  UpdateArtistInput
} from "@articket/shared";

type PrismaClientLike = typeof prismaClient;
type ArtistDb = Pick<PrismaClientLike, "artist">;
type EventArtistDb = Pick<PrismaClientLike, "eventArtist">;
type EventArtistListDb = Pick<PrismaClientLike, "event" | "eventArtist">;
type ArtistEventsDb = Pick<PrismaClientLike, "artist" | "eventArtist">;
type ArtistLinkTransaction = Parameters<Parameters<PrismaClientLike["$transaction"]>[0]>[0];
type ArtistLinkDb = Pick<PrismaClientLike, "$transaction">;

type ArtistRecord = Awaited<ReturnType<ArtistDb["artist"]["create"]>>;
type EventArtistCreateArgs = Parameters<ArtistLinkTransaction["eventArtist"]["create"]>[0];
type EventArtistUpdateArgs = Parameters<EventArtistDb["eventArtist"]["update"]>[0];

type EventArtistWithArtistRecord = {
  id: string;
  eventId: string;
  artistId: string;
  billingOrder: number | null;
  billingLabel: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  artist: ArtistRecord;
};

type EventArtistWithEventRecord = {
  id: string;
  eventId: string;
  artistId: string;
  billingOrder: number | null;
  billingLabel: string | null;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  event: {
    id: string;
    organizerId: string;
    name: string;
    slug: string;
    timezone: string;
    startsAt: Date;
    endsAt: Date;
    visibility: "draft" | "published" | "hidden";
    capacity: number;
  };
};

function normalizeJsonInput<T>(value: T | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  return value;
}

function mapArtist(artist: ArtistRecord): ArtistResponse {
  return {
    id: artist.id,
    slug: artist.slug,
    displayName: artist.displayName,
    legalOrFullName: artist.legalOrFullName,
    shortBio: artist.shortBio,
    profileImageUrl: artist.profileImageUrl,
    genreTagsJson: (artist.genreTagsJson as string[] | null) ?? null,
    externalLinksJson: (artist.externalLinksJson as { platform: string; url: string }[] | null) ?? null,
    status: artist.status as ArtistResponse["status"],
    createdAt: artist.createdAt.toISOString(),
    updatedAt: artist.updatedAt.toISOString()
  };
}

function mapEventArtist(link: EventArtistWithArtistRecord): EventArtistResponse {
  return {
    id: link.id,
    eventId: link.eventId,
    artistId: link.artistId,
    billingOrder: link.billingOrder,
    billingLabel: link.billingLabel,
    isPrimary: link.isPrimary,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    artist: mapArtist(link.artist)
  };
}

export async function createArtist(db: ArtistDb, input: CreateArtistInput): Promise<ArtistResponse> {
  const artist = await db.artist.create({
    data: {
      slug: input.slug,
      displayName: input.displayName,
      legalOrFullName: input.legalOrFullName,
      shortBio: input.shortBio,
      profileImageUrl: input.profileImageUrl,
      genreTagsJson: normalizeJsonInput(input.genreTagsJson),
      externalLinksJson: normalizeJsonInput(input.externalLinksJson),
      status: input.status ?? "active"
    }
  });

  return mapArtist(artist);
}

export async function updateArtist(
  db: ArtistDb,
  artistId: string,
  input: UpdateArtistInput
): Promise<ArtistResponse> {
  try {
    const artist = await db.artist.update({
      where: { id: artistId },
      data: {
        slug: input.slug,
        displayName: input.displayName,
        legalOrFullName: input.legalOrFullName === undefined ? undefined : input.legalOrFullName,
        shortBio: input.shortBio === undefined ? undefined : input.shortBio,
        profileImageUrl: input.profileImageUrl === undefined ? undefined : input.profileImageUrl,
        genreTagsJson: normalizeJsonInput(input.genreTagsJson),
        externalLinksJson: normalizeJsonInput(input.externalLinksJson),
        status: input.status
      }
    });

    return mapArtist(artist);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2025") {
      const notFound: Error & { statusCode?: number; code?: string } = new Error("Artist not found");
      notFound.statusCode = 404;
      notFound.code = "ARTIST_NOT_FOUND";
      throw notFound;
    }

    throw error;
  }
}

export async function listArtists(db: ArtistDb, query: ArtistListQueryInput): Promise<ArtistResponse[]> {
  const artists = await db.artist.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { displayName: { contains: query.q, mode: "insensitive" } },
              { slug: { contains: query.q, mode: "insensitive" } },
              { legalOrFullName: { contains: query.q, mode: "insensitive" } }
            ]
          }
        : {})
    },
    orderBy: [{ displayName: "asc" }, { createdAt: "asc" }],
    take: query.limit ?? 50
  });

  return artists.map(mapArtist);
}

export async function linkArtistToEvent(
  db: ArtistLinkDb,
  eventId: string,
  input: EventArtistLinkCreateInput
): Promise<EventArtistResponse> {
  try {
    const result = await db.$transaction(async (tx: ArtistLinkTransaction) => {
      await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { id: true } });
      await tx.artist.findUniqueOrThrow({ where: { id: input.artistId }, select: { id: true } });

      const data: EventArtistCreateArgs["data"] = {
        eventId,
        artistId: input.artistId,
        billingOrder: input.billingOrder,
        billingLabel: input.billingLabel,
        isPrimary: input.isPrimary ?? false
      };

      const link = await tx.eventArtist.create({
        data,
        include: { artist: true }
      });

      return link;
    });

    return mapEventArtist(result);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2025") {
        const notFound: Error & { statusCode?: number; code?: string } = new Error("Event or Artist not found");
        notFound.statusCode = 404;
        notFound.code = "ARTIST_OR_EVENT_NOT_FOUND";
        throw notFound;
      }

      if (code === "P2002") {
        const conflict: Error & { statusCode?: number; code?: string } = new Error("Artist already linked to event");
        conflict.statusCode = 409;
        conflict.code = "EVENT_ARTIST_DUPLICATE";
        throw conflict;
      }
    }

    throw error;
  }
}

export async function updateEventArtist(
  db: EventArtistDb,
  eventId: string,
  artistId: string,
  input: EventArtistUpdateInput
): Promise<EventArtistResponse> {
  try {
    const data: EventArtistUpdateArgs["data"] = {
      billingOrder: input.billingOrder === undefined ? undefined : input.billingOrder,
      billingLabel: input.billingLabel === undefined ? undefined : input.billingLabel,
      isPrimary: input.isPrimary === undefined ? undefined : input.isPrimary
    };

    const link = await db.eventArtist.update({
      where: { eventId_artistId: { eventId, artistId } },
      data,
      include: { artist: true }
    });

    return mapEventArtist(link);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2025") {
      const notFound: Error & { statusCode?: number; code?: string } = new Error("EventArtist link not found");
      notFound.statusCode = 404;
      notFound.code = "EVENT_ARTIST_LINK_NOT_FOUND";
      throw notFound;
    }

    throw error;
  }
}

export async function unlinkArtistFromEvent(
  db: EventArtistDb,
  eventId: string,
  artistId: string
): Promise<void> {
  const deleted = await db.eventArtist.deleteMany({ where: { eventId, artistId } });
  if (deleted.count === 0) {
    const notFound: Error & { statusCode?: number; code?: string } = new Error("EventArtist link not found");
    notFound.statusCode = 404;
    notFound.code = "EVENT_ARTIST_LINK_NOT_FOUND";
    throw notFound;
  }
}

export async function listArtistsByEvent(
  db: EventArtistListDb,
  eventId: string
): Promise<EventArtistListResponse> {
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) {
    const notFound: Error & { statusCode?: number; code?: string } = new Error("Event not found");
    notFound.statusCode = 404;
    notFound.code = "EVENT_NOT_FOUND";
    throw notFound;
  }

  const links = await db.eventArtist.findMany({
    where: { eventId },
    include: { artist: true },
    orderBy: [
      { billingOrder: "asc" },
      { createdAt: "asc" }
    ]
  });

  return {
    eventId,
    artists: links.map(mapEventArtist)
  };
}

export async function listEventsByArtist(
  db: ArtistEventsDb,
  artistId: string,
  query: ArtistEventsListQueryInput = {}
): Promise<ArtistEventListResponse> {
  const artist = await db.artist.findUnique({ where: { id: artistId }, select: { id: true } });
  if (!artist) {
    const notFound: Error & { statusCode?: number; code?: string } = new Error("Artist not found");
    notFound.statusCode = 404;
    notFound.code = "ARTIST_NOT_FOUND";
    throw notFound;
  }

  const links = await db.eventArtist.findMany({
    where: {
      artistId,
      ...(query.upcoming
        ? {
            event: {
              startsAt: { gte: new Date() }
            }
          }
        : {})
    },
    include: {
      event: {
        select: {
          id: true,
          organizerId: true,
          name: true,
          slug: true,
          timezone: true,
          startsAt: true,
          endsAt: true,
          visibility: true,
          capacity: true
        }
      }
    },
    orderBy: [
      { event: { startsAt: "asc" } },
      { billingOrder: "asc" },
      { createdAt: "asc" }
    ]
  }) as EventArtistWithEventRecord[];

  return {
    artistId,
    events: links.map((link: EventArtistWithEventRecord) => ({
      id: link.id,
      eventId: link.eventId,
      artistId: link.artistId,
      billingOrder: link.billingOrder,
      billingLabel: link.billingLabel,
      isPrimary: link.isPrimary,
      createdAt: link.createdAt.toISOString(),
      updatedAt: link.updatedAt.toISOString(),
      event: {
        id: link.event.id,
        organizerId: link.event.organizerId,
        name: link.event.name,
        slug: link.event.slug,
        timezone: link.event.timezone,
        startsAt: link.event.startsAt.toISOString(),
        endsAt: link.event.endsAt.toISOString(),
        visibility: link.event.visibility,
        capacity: link.event.capacity
      }
    }))
  };
}
