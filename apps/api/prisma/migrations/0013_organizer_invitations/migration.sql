-- CreateEnum
CREATE TYPE "OrganizerInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked');

-- CreateTable
CREATE TABLE "OrganizerInvitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizerId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailCanonical" TEXT NOT NULL,
    "role" "OrganizerRole" NOT NULL,
    "status" "OrganizerInvitationStatus" NOT NULL DEFAULT 'pending',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" UUID,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" UUID,
    "membershipId" UUID,

    CONSTRAINT "OrganizerInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizerInvitation_organizerId_status_createdAt_idx" ON "OrganizerInvitation"("organizerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_emailCanonical_status_createdAt_idx" ON "OrganizerInvitation"("emailCanonical", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_expiresAt_status_idx" ON "OrganizerInvitation"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_tokenHash_idx" ON "OrganizerInvitation"("tokenHash");

-- Partial unique indexes required by domain contract
CREATE UNIQUE INDEX "OrganizerInvitation_one_pending_per_email" ON "OrganizerInvitation"("organizerId", "emailCanonical") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "OrganizerInvitation_pending_tokenHash_unique" ON "OrganizerInvitation"("tokenHash") WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "Organizer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
