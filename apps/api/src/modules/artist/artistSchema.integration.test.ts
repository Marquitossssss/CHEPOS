import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "../payments/integrationTestEnv.js";

const created = {
  organizerIds: [] as string[],
  eventIds: [] as string[],
  artistIds: [] as string[],
  eventArtistIds: [] as string[]
};

async function seedEvent() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const organizer = await prisma.organizer.create({
    data: {
      name: `Artist Org ${suffix}`,
      slug: `artist-org-${suffix}`,
      serviceFeeBps: 0,
      taxBps: 0
    }
  });
  created.organizerIds.push(organizer.id);

  const event = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      name: `Artist Event ${suffix}`,
      slug: `artist-event-${suffix}`,
      timezone: "America/Buenos_Aires",
      startsAt: new Date(Date.now() + 60 * 60 * 1000),
      endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      capacity: 100,
      visibility: "published"
    }
  });
  created.eventIds.push(event.id);

  return { organizer, event };
}

async function seedArtist() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const artist = await prisma.artist.create({
    data: {
      slug: `artist-${suffix}`,
      displayName: `Artist ${suffix}`,
      legalOrFullName: `Artist Legal ${suffix}`,
      shortBio: "bio",
      profileImageUrl: "https://example.com/artist.jpg",
      genreTagsJson: ["rock", "indie"],
      externalLinksJson: [{ platform: "instagram", url: "https://instagram.com/example" }],
      status: "active"
    }
  });
  created.artistIds.push(artist.id);
  return artist;
}

describe.skipIf(!hasIntegrationEnv)("artist physical schema slice", () => {
  afterAll(async () => {
    if (created.eventArtistIds.length > 0) {
      await prisma.eventArtist.deleteMany({ where: { id: { in: created.eventArtistIds } } });
    }
    if (created.eventIds.length > 0) {
      await prisma.event.deleteMany({ where: { id: { in: created.eventIds } } });
    }
    if (created.artistIds.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: created.artistIds } } });
    }
    if (created.organizerIds.length > 0) {
      await prisma.organizer.deleteMany({ where: { id: { in: created.organizerIds } } });
    }
  });

  it("creates Artist and links it to Event through EventArtist", async () => {
    const { event } = await seedEvent();
    const artist = await seedArtist();

    const link = await prisma.eventArtist.create({
      data: {
        eventId: event.id,
        artistId: artist.id,
        billingOrder: 1,
        billingLabel: "Artista principal",
        isPrimary: true
      },
      include: {
        event: true,
        artist: true
      }
    });
    created.eventArtistIds.push(link.id);

    expect(link.eventId).toBe(event.id);
    expect(link.artistId).toBe(artist.id);
    expect(link.isPrimary).toBe(true);
    expect(link.artist.displayName).toBe(artist.displayName);
    expect(link.event.name).toBe(event.name);
  });

  it("does not allow duplicate EventArtist link for the same eventId+artistId", async () => {
    const { event } = await seedEvent();
    const artist = await seedArtist();

    const link = await prisma.eventArtist.create({
      data: {
        eventId: event.id,
        artistId: artist.id
      }
    });
    created.eventArtistIds.push(link.id);

    await expect(
      prisma.eventArtist.create({
        data: {
          eventId: event.id,
          artistId: artist.id
        }
      })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("enforces foreign keys and Artist delete restriction while linked", async () => {
    const { event } = await seedEvent();
    const artist = await seedArtist();

    const link = await prisma.eventArtist.create({
      data: {
        eventId: event.id,
        artistId: artist.id
      }
    });
    created.eventArtistIds.push(link.id);

    await expect(
      prisma.eventArtist.create({
        data: {
          eventId: "00000000-0000-0000-0000-000000000000",
          artistId: artist.id
        }
      })
    ).rejects.toMatchObject({ code: "P2003" });

    await expect(prisma.artist.delete({ where: { id: artist.id } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("cascades Event delete to EventArtist rows", async () => {
    const { event } = await seedEvent();
    const artist = await seedArtist();

    const link = await prisma.eventArtist.create({
      data: {
        eventId: event.id,
        artistId: artist.id
      }
    });

    await prisma.event.delete({ where: { id: event.id } });
    created.eventIds.splice(created.eventIds.indexOf(event.id), 1);

    const found = await prisma.eventArtist.findUnique({ where: { id: link.id } });
    expect(found).toBeNull();
  });
});
