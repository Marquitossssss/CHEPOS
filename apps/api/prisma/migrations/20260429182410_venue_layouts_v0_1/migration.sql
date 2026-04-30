-- CreateEnum
CREATE TYPE "VenueType" AS ENUM ('theater', 'stadium', 'arena', 'club', 'general_admission', 'mixed');

-- CreateEnum
CREATE TYPE "VenueStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "VenueLayoutMode" AS ENUM ('seated', 'ga', 'mixed');

-- CreateTable
CREATE TABLE "Venue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "venueType" "VenueType" NOT NULL,
    "locationJson" JSONB,
    "status" "VenueStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueLayoutTemplate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "venueId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "layoutMode" "VenueLayoutMode" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL,

    CONSTRAINT "VenueLayoutTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VenueLayoutVersion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "templateId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "layoutData" JSONB NOT NULL,
    "layoutHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(6) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueLayoutVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventLayoutSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "layoutVersionId" UUID NOT NULL,
    "snapshotData" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLayoutSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Venue_organizerId_status_createdAt_idx" ON "Venue"("organizerId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_organizerId_slug_key" ON "Venue"("organizerId", "slug");

-- CreateIndex
CREATE INDEX "VenueLayoutTemplate_venueId_isActive_createdAt_idx" ON "VenueLayoutTemplate"("venueId", "isActive", "createdAt");

-- CreateIndex
CREATE INDEX "VenueLayoutVersion_templateId_publishedAt_createdAt_idx" ON "VenueLayoutVersion"("templateId", "publishedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VenueLayoutVersion_templateId_versionNumber_key" ON "VenueLayoutVersion"("templateId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EventLayoutSnapshot_eventId_key" ON "EventLayoutSnapshot"("eventId");

-- CreateIndex
CREATE INDEX "EventLayoutSnapshot_venueId_createdAt_idx" ON "EventLayoutSnapshot"("venueId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLayoutSnapshot_templateId_createdAt_idx" ON "EventLayoutSnapshot"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "EventLayoutSnapshot_layoutVersionId_createdAt_idx" ON "EventLayoutSnapshot"("layoutVersionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueLayoutTemplate" ADD CONSTRAINT "VenueLayoutTemplate_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueLayoutVersion" ADD CONSTRAINT "VenueLayoutVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "VenueLayoutTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueLayoutVersion" ADD CONSTRAINT "VenueLayoutVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLayoutSnapshot" ADD CONSTRAINT "EventLayoutSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLayoutSnapshot" ADD CONSTRAINT "EventLayoutSnapshot_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLayoutSnapshot" ADD CONSTRAINT "EventLayoutSnapshot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "VenueLayoutTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLayoutSnapshot" ADD CONSTRAINT "EventLayoutSnapshot_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "VenueLayoutVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventLayoutSnapshot" ADD CONSTRAINT "EventLayoutSnapshot_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

