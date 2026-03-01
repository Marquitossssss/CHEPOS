import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "owner@articket.local" },
    update: {},
    create: { email: "owner@articket.local", passwordHash: await bcrypt.hash("afaafc29a40aa", 12) }
  });

  const organizer = await prisma.organizer.upsert({
    where: { slug: "demo-org" },
    update: {},
    create: { name: "Demo Org", slug: "demo-org", serviceFeeBps: 500, taxBps: 2100 }
  });

  await prisma.membership.upsert({
    where: { userId_organizerId: { userId: user.id, organizerId: organizer.id } },
    update: { role: "owner" },
    create: { userId: user.id, organizerId: organizer.id, role: "owner" }
  });

  const event = await prisma.event.create({
    data: {
      organizerId: organizer.id,
      name: "Concierto Demo",
      slug: `concierto-demo-${Date.now()}`,
      timezone: "America/Argentina/Buenos_Aires",
      startsAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      endsAt: new Date(Date.now() + 1000 * 60 * 60 * 26),
      capacity: 1000,
      visibility: "published"
    }
  });

  const ticketType = await prisma.ticketType.create({ data: { eventId: event.id, name: "General", priceCents: 10000, currency: "ARS", quota: 500 } });

  const order = await prisma.order.upsert({
    where: { orderNumber: "DEMO-ORDER-0001" },
    update: { status: "paid", totalCents: 10000, subtotalCents: 10000 },
    create: {
      organizerId: organizer.id,
      eventId: event.id,
      userId: user.id,
      orderNumber: "DEMO-ORDER-0001",
      customerEmail: user.email,
      status: "paid",
      subtotalCents: 10000,
      totalCents: 10000,
      items: {
        create: {
          ticketTypeId: ticketType.id,
          quantity: 1,
          unitPriceCents: 10000,
          totalCents: 10000
        }
      }
    }
  });

  await prisma.ticket.upsert({
    where: { code: "DEMO-TICKET-0001" },
    update: { status: "issued", eventId: event.id, orderId: order.id, ticketTypeId: ticketType.id },
    create: {
      orderId: order.id,
      ticketTypeId: ticketType.id,
      eventId: event.id,
      status: "issued",
      code: "DEMO-TICKET-0001",
      qrPayload: "demo-qr-payload"
    }
  });
}

main().finally(async () => prisma.$disconnect());
