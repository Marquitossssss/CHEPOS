export const CLAIM_LEASE_MINUTES = 15;

type ClaimSnapshot = {
  claimedBy: string | null;
  claimExpiresAt: Date | null;
};

export function isClaimActive(snapshot: ClaimSnapshot, now = new Date()): boolean {
  if (!snapshot.claimedBy || !snapshot.claimExpiresAt) return false;
  return snapshot.claimExpiresAt.getTime() > now.getTime();
}

export function canActorClaim(snapshot: ClaimSnapshot, actorId: string, now = new Date()): boolean {
  if (!snapshot.claimedBy) return true;
  if (snapshot.claimedBy === actorId) return true;
  return !isClaimActive(snapshot, now);
}

export function claimExpiryFrom(now = new Date(), leaseMinutes = CLAIM_LEASE_MINUTES): Date {
  return new Date(now.getTime() + leaseMinutes * 60_000);
}
