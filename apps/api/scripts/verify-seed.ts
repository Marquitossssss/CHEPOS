import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Check = { label: string; ok: boolean; detail?: string };

const DEMO_ORDER_PREFIX = "DEMO-ORDER-";
const DEMO_TICKET_PREFIX = "DEMO-TICKET-";

async function scalarInt(sql: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ value: bigint | number }>>(sql);
  return Number(rows[0]?.value ?? 0);
}

function push(checks: Check[], label: string, ok: boolean, detail?: string) {
  checks.push({ label, ok, detail });
}

async function main() {
  const checks: Check[] = [];

  const organizer = await prisma.organizer.findUnique({ where: { slug: "demo-org" }, select: { id: true } });
  const event = await prisma.event.findUnique({ where: { organizerId_slug: organizer ? { organizerId: organizer.id, slug: "demo-event-1" } : { organizerId: "00000000-0000-0000-0000-000000000000", slug: "demo-event-1" } }, select: { id: true } }).catch(() => null);

  if (!organizer || !event) {
    throw new Error("demo_rich dataset missing (demo-org / demo-event-1 not found). Run SEED_PROFILE=demo_rich pnpm -w db:seed first.");
  }

  const eventId = event.id;

  const eventsCount = await prisma.event.count({ where: { slug: { in: ["demo-event-1", "demo-event-2", "demo-event-3"] } } });
  const paidOrders = await prisma.order.count({ where: { eventId, status: "paid" } });
  const totalTickets = await prisma.ticket.count({ where: { eventId, code: { startsWith: DEMO_TICKET_PREFIX } } });
  const checkedIn = await prisma.ticket.count({ where: { eventId, code: { startsWith: DEMO_TICKET_PREFIX }, status: "checked_in" } });
  const ticketTypes = await prisma.ticketType.count({ where: { eventId } });
  const revenuePaid = (await prisma.order.aggregate({
    where: { eventId, status: "paid", orderNumber: { startsWith: DEMO_ORDER_PREFIX } },
    _sum: { totalCents: true }
  }))._sum.totalCents ?? 0;

  push(checks, "dataset.minimum.events>=3", eventsCount >= 3, `events=${eventsCount}`);
  push(checks, "dataset.minimum.ordersPaid>=10", paidOrders >= 10, `ordersPaid=${paidOrders}`);
  push(checks, "dataset.minimum.tickets>=10", totalTickets >= 10, `tickets=${totalTickets}`);
  push(checks, "dataset.minimum.checkedIn>=3", checkedIn >= 3, `checkedIn=${checkedIn}`);
  push(checks, "dataset.minimum.ticketTypes>=3", ticketTypes >= 3, `ticketTypes=${ticketTypes}`);

  const duplicateDemoOrders = await scalarInt(`
    SELECT COUNT(*)::bigint AS value
    FROM (
      SELECT "orderNumber"
      FROM "Order"
      WHERE "orderNumber" LIKE '${DEMO_ORDER_PREFIX}%'
      GROUP BY "orderNumber"
      HAVING COUNT(*) > 1
    ) x;
  `);
  push(checks, "invariant.noDuplicateDemoOrderNumbers", duplicateDemoOrders === 0, `duplicates=${duplicateDemoOrders}`);

  const duplicateDemoTickets = await scalarInt(`
    SELECT COUNT(*)::bigint AS value
    FROM (
      SELECT code
      FROM "Ticket"
      WHERE code LIKE '${DEMO_TICKET_PREFIX}%'
      GROUP BY code
      HAVING COUNT(*) > 1
    ) x;
  `);
  push(checks, "invariant.noDuplicateDemoTicketCodes", duplicateDemoTickets === 0, `duplicates=${duplicateDemoTickets}`);

  const overbookedTicketTypes = await scalarInt(`
    WITH sold AS (
      SELECT t."ticketTypeId", COUNT(*)::bigint AS sold
      FROM "Ticket" t
      JOIN "Order" o ON o.id = t."orderId"
      WHERE t."eventId" = '${eventId}'::uuid
        AND o.status = 'paid'
        AND t.status IN ('issued','checked_in')
      GROUP BY t."ticketTypeId"
    ),
    reserved AS (
      SELECT r."ticketTypeId", COALESCE(SUM(r.quantity),0)::bigint AS reserved_active
      FROM "InventoryReservation" r
      JOIN "Order" o ON o.id = r."orderId"
      WHERE o."eventId" = '${eventId}'::uuid
        AND r."releasedAt" IS NULL
        AND r."expiresAt" > NOW()
      GROUP BY r."ticketTypeId"
    )
    SELECT COUNT(*)::bigint AS value
    FROM "TicketType" tt
    LEFT JOIN sold s ON s."ticketTypeId" = tt.id
    LEFT JOIN reserved r ON r."ticketTypeId" = tt.id
    WHERE tt."eventId" = '${eventId}'::uuid
      AND (COALESCE(s.sold,0) + COALESCE(r.reserved_active,0)) > tt.quota;
  `);
  push(checks, "invariant.noOverbooking", overbookedTicketTypes === 0, `overbookedTicketTypes=${overbookedTicketTypes}`);

  const checkedInGtSold = await scalarInt(`
    WITH sold AS (
      SELECT COUNT(*)::bigint AS sold
      FROM "Ticket" t
      JOIN "Order" o ON o.id = t."orderId"
      WHERE t."eventId" = '${eventId}'::uuid
        AND o.status = 'paid'
        AND t.status IN ('issued','checked_in')
    ),
    checked AS (
      SELECT COUNT(*)::bigint AS checked_in
      FROM "Ticket" t
      JOIN "Order" o ON o.id = t."orderId"
      WHERE t."eventId" = '${eventId}'::uuid
        AND o.status = 'paid'
        AND t.status = 'checked_in'
    )
    SELECT CASE WHEN (SELECT checked_in FROM checked) <= (SELECT sold FROM sold) THEN 0 ELSE 1 END::bigint AS value;
  `);
  push(checks, "invariant.checkedIn<=sold", checkedInGtSold === 0);

  const activeTicketsOnInvalidOrders = await scalarInt(`
    SELECT COUNT(*)::bigint AS value
    FROM "Ticket" t
    JOIN "Order" o ON o.id = t."orderId"
    WHERE t."eventId" = '${eventId}'::uuid
      AND o.status IN ('canceled','refunded','expired')
      AND t.status IN ('issued','checked_in');
  `);
  push(checks, "invariant.noActiveTicketsOnCanceledRefundedExpired", activeTicketsOnInvalidOrders === 0, `violations=${activeTicketsOnInvalidOrders}`);

  const activeReservationsExpired = await scalarInt(`
    SELECT COUNT(*)::bigint AS value
    FROM "InventoryReservation" r
    JOIN "Order" o ON o.id = r."orderId"
    WHERE o."eventId" = '${eventId}'::uuid
      AND r."releasedAt" IS NULL
      AND r."expiresAt" <= NOW();
  `);
  push(checks, "invariant.activeReservationsMustExpireInFuture", activeReservationsExpired === 0, `violations=${activeReservationsExpired}`);

  const emailFailures = await prisma.emailEvent.count({
    where: {
      sgEventId: { startsWith: "DEMO-SG-" },
      eventType: { in: ["bounce", "dropped", "deferred", "blocked", "spamreport", "unsubscribe"] }
    }
  });
  push(checks, "dataset.alerts.emailFailures>=1", emailFailures >= 1, `emailFailures=${emailFailures}`);

  const failed = checks.filter((c) => !c.ok);

  const totalOrders = await prisma.order.count({ where: { eventId, orderNumber: { startsWith: DEMO_ORDER_PREFIX } } });
  console.log(`✔ Events: ${eventsCount}`);
  console.log(`✔ Orders: ${totalOrders}`);
  console.log(`✔ Tickets: ${totalTickets}`);
  console.log(`✔ Revenue Paid: ${revenuePaid}`);
  console.log(`✔ CheckedIn: ${checkedIn}`);

  if (failed.length > 0) {
    console.error("✖ Invariant violations:");
    for (const item of failed) {
      console.error(` - ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
    }
    process.exit(1);
  }

  console.log("✔ No invariant violations");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
