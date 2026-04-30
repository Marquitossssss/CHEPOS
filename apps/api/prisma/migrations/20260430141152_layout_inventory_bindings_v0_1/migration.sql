-- CreateEnum
CREATE TYPE "LayoutEntityType" AS ENUM ('zone', 'seat');

-- CreateTable
CREATE TABLE "EventLayoutInventoryBinding" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventLayoutSnapshotId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "ticketTypeId" UUID NOT NULL,
    "layoutEntityType" "LayoutEntityType" NOT NULL,
    "layoutEntityId" TEXT NOT NULL,
    "capacityLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "EventLayoutInventoryBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLayoutInventoryBinding_eventId_createdAt_idx" ON "EventLayoutInventoryBinding"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLayoutInventoryBinding_eventLayoutSnapshotId_isActive__idx" ON "EventLayoutInventoryBinding"("eventLayoutSnapshotId", "isActive", "createdAt");

-- CreateIndex
CREATE INDEX "EventLayoutInventoryBinding_ticketTypeId_createdAt_idx" ON "EventLayoutInventoryBinding"("ticketTypeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventLayoutInventoryBinding_eventLayoutSnapshotId_layoutEnt_key" ON "EventLayoutInventoryBinding"("eventLayoutSnapshotId", "layoutEntityType", "layoutEntityId", "ticketTypeId");

-- AddForeignKey
ALTER TABLE "EventLayoutInventoryBinding" ADD CONSTRAINT "EventLayoutInventoryBinding_eventLayoutSnapshotId_fkey" FOREIGN KEY ("eventLayoutSnapshotId") REFERENCES "EventLayoutSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLayoutInventoryBinding" ADD CONSTRAINT "EventLayoutInventoryBinding_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLayoutInventoryBinding" ADD CONSTRAINT "EventLayoutInventoryBinding_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLayoutInventoryBinding" ADD CONSTRAINT "EventLayoutInventoryBinding_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
