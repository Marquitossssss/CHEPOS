import { describe, expect, it } from "vitest";
import { fetchEventActivity } from "./service.js";

type EventRow = {
  id: string;
  occurredAt: Date;
  type: string;
  payload: Record<string, unknown>;
  orderId: string | null;
  ticketId: string | null;
};

function buildPrisma({ membership, rows = [] as EventRow[] }: { membership: any; rows?: EventRow[] }) {
  return {
    event: {
      findUniqueOrThrow: async () => ({ id: "event-1", organizerId: "org-1" })
    },
    membership: {
      findUnique: async ({ where }: any) => {
        if (!membership) return null;
        if (membership.organizerId && membership.organizerId !== where.userId_organizerId.organizerId) return null;
        return membership;
      }
    },
    domainEvent: {
      findMany: async ({ where, take }: any) => {
        let filtered = [...rows].sort((a, b) => {
          if (a.occurredAt.getTime() !== b.occurredAt.getTime()) {
            return b.occurredAt.getTime() - a.occurredAt.getTime();
          }
          return b.id.localeCompare(a.id);
        });

        if (where?.type?.in) {
          filtered = filtered.filter((row) => where.type.in.includes(row.type));
        }

        if (where?.OR?.length) {
          const cursorTime = where.OR[0].occurredAt.lt as Date;
          const cursorId = where.OR[1].id.lt as string;
          filtered = filtered.filter((row) => (
            row.occurredAt.getTime() < cursorTime.getTime()
            || (row.occurredAt.getTime() === cursorTime.getTime() && row.id < cursorId)
          ));
        }

        return filtered.slice(0, take);
      }
    }
  } as any;
}

describe("fetchEventActivity", () => {
  it("rechaza usuario sin membership", async () => {
    await expect(
      fetchEventActivity(buildPrisma({ membership: null }), {
        eventId: "event-1",
        userId: "user-1"
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rechaza usuario de otro organizer (anti data leak)", async () => {
    await expect(
      fetchEventActivity(buildPrisma({ membership: { role: "staff", organizerId: "org-2" } }), {
        eventId: "event-1",
        userId: "user-1"
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("paginación por cursor estable (sin duplicar ni omitir)", async () => {
    const rows: EventRow[] = [
      { id: "evt-4", occurredAt: new Date("2025-01-02T10:00:00.000Z"), type: "ORDER_PAID", payload: {}, orderId: "o-4", ticketId: null },
      { id: "evt-3", occurredAt: new Date("2025-01-02T10:00:00.000Z"), type: "ORDER_RESERVED", payload: {}, orderId: "o-3", ticketId: null },
      { id: "evt-2", occurredAt: new Date("2025-01-01T10:00:00.000Z"), type: "TICKETS_ISSUED", payload: { issuedCount: 2 }, orderId: "o-2", ticketId: null },
      { id: "evt-1", occurredAt: new Date("2025-01-01T09:00:00.000Z"), type: "TICKET_CHECKED_IN", payload: {}, orderId: null, ticketId: "t-1" }
    ];

    const prisma = buildPrisma({ membership: { role: "staff" }, rows });

    const page1 = await fetchEventActivity(prisma, { eventId: "event-1", userId: "user-1", limit: 2 });
    expect(page1.items.map((x: any) => x.id)).toEqual(["evt-4", "evt-3"]);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await fetchEventActivity(prisma, {
      eventId: "event-1",
      userId: "user-1",
      limit: 2,
      cursor: page1.nextCursor ?? undefined
    });

    expect(page2.items.map((x: any) => x.id)).toEqual(["evt-2", "evt-1"]);

    const all = [...page1.items, ...page2.items].map((x: any) => x.id);
    expect(all).toEqual(["evt-4", "evt-3", "evt-2", "evt-1"]);
    expect(new Set(all).size).toBe(4);
  });

  it("includePayload se ignora para roles no privilegiados", async () => {
    const rows: EventRow[] = [
      {
        id: "evt-1",
        occurredAt: new Date("2025-01-01T12:00:00.000Z"),
        type: "TICKET_CHECKED_IN",
        payload: { actorUserId: "user-staff", secret: "internal" },
        orderId: "ord-1",
        ticketId: "tkt-1"
      }
    ];

    const res = await fetchEventActivity(buildPrisma({ membership: { role: "staff" }, rows }), {
      eventId: "event-1",
      userId: "user-1",
      includePayload: true
    });

    expect(res.items[0]).not.toHaveProperty("payload");
  });
});
