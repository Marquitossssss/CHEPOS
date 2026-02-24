import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "owner@articket.local" },
    update: {},
    create: { email: "owner@articket.local", passwordHash: await bcrypt.hash("Password123!", 12) }
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

  await prisma.ticketType.create({ data: { eventId: event.id, name: "General", priceCents: 10000, currency: "ARS", quota: 500 } });
}

main().finally(async () => prisma.$disconnect());
