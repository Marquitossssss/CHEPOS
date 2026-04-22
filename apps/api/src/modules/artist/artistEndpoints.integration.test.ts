import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { hasIntegrationEnv } from "../payments/integrationTestEnv.js";
import { allocateIntegrationPort, startIntegrationServer, stopIntegrationServer } from "../../test/integrationServerHarness.js";

const suiteKey = "artist-endpoints";
process.env.API_PORT = process.env.API_PORT ?? String(allocateIntegrationPort(suiteKey));
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

const baseUrl = `http://127.0.0.1:${process.env.API_PORT}`;

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy in time");
}

describe.skipIf(!hasIntegrationEnv)("artist endpoints minimal admin slice", () => {
  const created = {
    userIds: [] as string[],
    organizerIds: [] as string[],
    membershipIds: [] as string[],
    eventIds: [] as string[],
    artistIds: [] as string[],
    eventArtistIds: [] as string[]
  };

  beforeAll(async () => {
    await startIntegrationServer(suiteKey);
    await waitForHealth();
  });

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
    if (created.membershipIds.length > 0) {
      await prisma.membership.deleteMany({ where: { id: { in: created.membershipIds } } });
    }
    if (created.organizerIds.length > 0) {
      await prisma.organizer.deleteMany({ where: { id: { in: created.organizerIds } } });
    }
    if (created.userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    }
    await stopIntegrationServer(suiteKey);
  });

  async function createUser(emailPrefix: string) {
    const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const password = "Password123!";
    const passwordHash = await bcrypt.hash(password, 4);
    const user = await prisma.user.create({ data: { email, passwordHash } });
    created.userIds.push(user.id);
    return { user, email, password };
  }

  async function login(email: string, password: string) {
    const r = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    expect(r.status).toBe(200);
    const json = await r.json() as { accessToken: string };
    return json.accessToken;
  }

  async function seedScenario() {
    const organizer = await prisma.organizer.create({
      data: {
        name: `Artist API Org ${Date.now()}`,
        slug: `artist-api-org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        serviceFeeBps: 0,
        taxBps: 0
      }
    });
    created.organizerIds.push(organizer.id);

    const owner = await createUser("artist-api-owner");
    const ownerMembership = await prisma.membership.create({
      data: { userId: owner.user.id, organizerId: organizer.id, role: "owner" }
    });
    created.membershipIds.push(ownerMembership.id);

    const event = await prisma.event.create({
      data: {
        organizerId: organizer.id,
        name: `Artist API Event ${Date.now()}`,
        slug: `artist-api-event-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timezone: "America/Argentina/Buenos_Aires",
        startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 25 * 60 * 60 * 1000),
        capacity: 500,
        visibility: "published"
      }
    });
    created.eventIds.push(event.id);

    return { organizer, owner, event };
  }

  it("creates Artist and lists Artists", async () => {
    const scenario = await seedScenario();
    const token = await login(scenario.owner.email, scenario.owner.password);

    const create = await fetch(`${baseUrl}/artists`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-organizer-id": scenario.organizer.id
      },
      body: JSON.stringify({
        slug: `artist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Test Artist",
        genreTagsJson: ["rock"],
        externalLinksJson: [{ platform: "instagram", url: "https://instagram.com/test-artist" }]
      })
    });

    expect(create.status).toBe(200);
    const createdArtist = await create.json() as any;
    created.artistIds.push(createdArtist.id);
    expect(createdArtist.displayName).toBe("Test Artist");
    expect(createdArtist.status).toBe("active");

    const list = await fetch(`${baseUrl}/artists`);
    expect(list.status).toBe(200);
    const artists = await list.json() as any[];
    expect(artists.some((artist) => artist.id === createdArtist.id && artist.displayName === "Test Artist")).toBe(true);
  });

  it("updates Artist and preserves slug uniqueness", async () => {
    const scenario = await seedScenario();
    const token = await login(scenario.owner.email, scenario.owner.password);

    const a = await prisma.artist.create({
      data: {
        slug: `artist-update-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Artist A",
        status: "active"
      }
    });
    const b = await prisma.artist.create({
      data: {
        slug: `artist-update-b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Artist B",
        status: "active"
      }
    });
    created.artistIds.push(a.id, b.id);

    const update = await fetch(`${baseUrl}/artists/${a.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-organizer-id": scenario.organizer.id
      },
      body: JSON.stringify({
        slug: a.slug,
        displayName: "Artist A Updated",
        legalOrFullName: "Artist A Legal",
        shortBio: "updated bio",
        profileImageUrl: "https://example.com/a.jpg",
        genreTagsJson: ["indie"],
        externalLinksJson: [{ platform: "spotify", url: "https://spotify.com/a" }],
        status: "inactive"
      })
    });

    expect(update.status).toBe(200);
    const updated = await update.json() as any;
    expect(updated.displayName).toBe("Artist A Updated");
    expect(updated.status).toBe("inactive");

    const conflict = await fetch(`${baseUrl}/artists/${a.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-organizer-id": scenario.organizer.id
      },
      body: JSON.stringify({
        slug: b.slug,
        displayName: "Artist A Updated Again",
        status: "active"
      })
    });

    expect(conflict.status).toBe(409);
  });

  it("creates EventArtist link and lists artists by event", async () => {
    const scenario = await seedScenario();
    const token = await login(scenario.owner.email, scenario.owner.password);

    const artist = await prisma.artist.create({
      data: {
        slug: `linked-artist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Linked Artist",
        status: "active"
      }
    });
    created.artistIds.push(artist.id);

    const link = await fetch(`${baseUrl}/events/${scenario.event.id}/artists`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        artistId: artist.id,
        billingOrder: 1,
        billingLabel: "Headliner",
        isPrimary: true
      })
    });

    expect(link.status).toBe(200);
    const linked = await link.json() as any;
    created.eventArtistIds.push(linked.id);
    expect(linked.artistId).toBe(artist.id);
    expect(linked.eventId).toBe(scenario.event.id);
    expect(linked.artist.displayName).toBe("Linked Artist");

    const list = await fetch(`${baseUrl}/events/${scenario.event.id}/artists`);
    expect(list.status).toBe(200);
    const body = await list.json() as any;
    expect(body.eventId).toBe(scenario.event.id);
    expect(body.artists).toHaveLength(1);
    expect(body.artists[0].artist.id).toBe(artist.id);
  });

  it("updates EventArtist link metadata", async () => {
    const scenario = await seedScenario();
    const token = await login(scenario.owner.email, scenario.owner.password);

    const artist = await prisma.artist.create({
      data: {
        slug: `update-link-artist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Update Link Artist",
        status: "active"
      }
    });
    created.artistIds.push(artist.id);

    const link = await prisma.eventArtist.create({
      data: {
        eventId: scenario.event.id,
        artistId: artist.id,
        billingOrder: 1,
        billingLabel: "Support",
        isPrimary: false
      }
    });
    created.eventArtistIds.push(link.id);

    const update = await fetch(`${baseUrl}/events/${scenario.event.id}/artists/${artist.id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        billingOrder: 5,
        billingLabel: "Headliner",
        isPrimary: true
      })
    });

    expect(update.status).toBe(200);
    const updated = await update.json() as any;
    expect(updated.eventId).toBe(scenario.event.id);
    expect(updated.artistId).toBe(artist.id);
    expect(updated.billingOrder).toBe(5);
    expect(updated.billingLabel).toBe("Headliner");
    expect(updated.isPrimary).toBe(true);

    const persisted = await prisma.eventArtist.findUniqueOrThrow({
      where: { eventId_artistId: { eventId: scenario.event.id, artistId: artist.id } }
    });
    expect(persisted.billingOrder).toBe(5);
    expect(persisted.billingLabel).toBe("Headliner");
    expect(persisted.isPrimary).toBe(true);
  });

  it("returns 404 when updating a missing EventArtist link", async () => {
    const scenario = await seedScenario();
    const token = await login(scenario.owner.email, scenario.owner.password);

    const response = await fetch(`${baseUrl}/events/${scenario.event.id}/artists/00000000-0000-0000-0000-000000000000`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ isPrimary: true })
    });

    expect(response.status).toBe(404);
  });

  it("returns events by artist with link metadata", async () => {
    const scenario = await seedScenario();
    const artist = await prisma.artist.create({
      data: {
        slug: `artist-events-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Artist Events",
        status: "active"
      }
    });
    created.artistIds.push(artist.id);

    const link = await prisma.eventArtist.create({
      data: {
        eventId: scenario.event.id,
        artistId: artist.id,
        billingOrder: 2,
        billingLabel: "Guest",
        isPrimary: false
      }
    });
    created.eventArtistIds.push(link.id);

    const response = await fetch(`${baseUrl}/artists/${artist.id}/events`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.artistId).toBe(artist.id);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].event.id).toBe(scenario.event.id);
    expect(body.events[0].billingOrder).toBe(2);
    expect(body.events[0].billingLabel).toBe("Guest");
    expect(body.events[0].isPrimary).toBe(false);
  });

  it("filters events by artist with upcoming=true", async () => {
    const scenario = await seedScenario();
    const artist = await prisma.artist.create({
      data: {
        slug: `artist-upcoming-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Artist Upcoming",
        status: "active"
      }
    });
    created.artistIds.push(artist.id);

    const pastEvent = await prisma.event.create({
      data: {
        organizerId: scenario.organizer.id,
        name: `Past Artist Event ${Date.now()}`,
        slug: `past-artist-event-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timezone: "America/Argentina/Buenos_Aires",
        startsAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() - 47 * 60 * 60 * 1000),
        capacity: 200,
        visibility: "published"
      }
    });
    created.eventIds.push(pastEvent.id);

    const upcomingLink = await prisma.eventArtist.create({
      data: {
        eventId: scenario.event.id,
        artistId: artist.id,
        billingOrder: 1
      }
    });
    const pastLink = await prisma.eventArtist.create({
      data: {
        eventId: pastEvent.id,
        artistId: artist.id,
        billingOrder: 2
      }
    });
    created.eventArtistIds.push(upcomingLink.id, pastLink.id);

    const response = await fetch(`${baseUrl}/artists/${artist.id}/events?upcoming=true`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.events).toHaveLength(1);
    expect(body.events[0].event.id).toBe(scenario.event.id);
  });

  it("does not duplicate event-artist link", async () => {
    const scenario = await seedScenario();
    const token = await login(scenario.owner.email, scenario.owner.password);

    const artist = await prisma.artist.create({
      data: {
        slug: `dup-artist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Dup Artist",
        status: "active"
      }
    });
    created.artistIds.push(artist.id);

    const first = await fetch(`${baseUrl}/events/${scenario.event.id}/artists`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ artistId: artist.id })
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as any;
    created.eventArtistIds.push(firstBody.id);

    const second = await fetch(`${baseUrl}/events/${scenario.event.id}/artists`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ artistId: artist.id })
    });

    expect(second.status).toBe(409);
  });

  it("unlinks Artist from Event and returns consistent 404 when link is missing", async () => {
    const scenario = await seedScenario();
    const token = await login(scenario.owner.email, scenario.owner.password);

    const artist = await prisma.artist.create({
      data: {
        slug: `unlink-artist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        displayName: "Unlink Artist",
        status: "active"
      }
    });
    created.artistIds.push(artist.id);

    const link = await prisma.eventArtist.create({
      data: {
        eventId: scenario.event.id,
        artistId: artist.id
      }
    });
    created.eventArtistIds.push(link.id);

    const unlink = await fetch(`${baseUrl}/events/${scenario.event.id}/artists/${artist.id}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(unlink.status).toBe(200);
    const unlinkBody = await unlink.json() as any;
    expect(unlinkBody.removed).toBe(true);

    created.eventArtistIds = created.eventArtistIds.filter((id) => id !== link.id);

    const after = await fetch(`${baseUrl}/events/${scenario.event.id}/artists`);
    expect(after.status).toBe(200);
    const afterBody = await after.json() as any;
    expect(afterBody.artists).toHaveLength(0);

    const missing = await fetch(`${baseUrl}/events/${scenario.event.id}/artists/${artist.id}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(missing.status).toBe(404);
  });

  it("rejects link when artist does not exist", async () => {
    const scenario = await seedScenario();
    const token = await login(scenario.owner.email, scenario.owner.password);

    const response = await fetch(`${baseUrl}/events/${scenario.event.id}/artists`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ artistId: "00000000-0000-0000-0000-000000000000" })
    });

    expect(response.status).toBe(404);
  });
});
