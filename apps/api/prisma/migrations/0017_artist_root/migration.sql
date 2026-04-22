-- CreateEnum
CREATE TYPE "ArtistStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "Artist" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "legalOrFullName" TEXT,
    "shortBio" TEXT,
    "profileImageUrl" TEXT,
    "genreTagsJson" JSONB,
    "externalLinksJson" JSONB,
    "status" "ArtistStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventArtist" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "artistId" UUID NOT NULL,
    "billingOrder" INTEGER,
    "billingLabel" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventArtist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_slug_key" ON "Artist"("slug");

-- CreateIndex
CREATE INDEX "Artist_status_createdAt_idx" ON "Artist"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Artist_displayName_idx" ON "Artist"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "EventArtist_eventId_artistId_key" ON "EventArtist"("eventId", "artistId");

-- CreateIndex
CREATE INDEX "EventArtist_eventId_billingOrder_idx" ON "EventArtist"("eventId", "billingOrder");

-- CreateIndex
CREATE INDEX "EventArtist_artistId_idx" ON "EventArtist"("artistId");

-- CreateIndex
CREATE INDEX "EventArtist_eventId_isPrimary_idx" ON "EventArtist"("eventId", "isPrimary");

-- AddForeignKey
ALTER TABLE "EventArtist" ADD CONSTRAINT "EventArtist_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventArtist" ADD CONSTRAINT "EventArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
