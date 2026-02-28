import { describe, expect, it } from "vitest";
import { canActorClaim, isClaimActive } from "./latePaymentClaimLease.js";

describe("latePaymentClaimLease", () => {
  it("returns conflict when claimed by another operator and lease still active", () => {
    const now = new Date("2026-02-28T21:00:00.000Z");
    const snapshot = {
      claimedBy: "operator-a",
      claimExpiresAt: new Date("2026-02-28T21:10:00.000Z")
    };

    expect(isClaimActive(snapshot, now)).toBe(true);
    expect(canActorClaim(snapshot, "operator-b", now)).toBe(false);
  });

  it("allows claim when previous lease is expired", () => {
    const now = new Date("2026-02-28T21:00:00.000Z");
    const snapshot = {
      claimedBy: "operator-a",
      claimExpiresAt: new Date("2026-02-28T20:40:00.000Z")
    };

    expect(isClaimActive(snapshot, now)).toBe(false);
    expect(canActorClaim(snapshot, "operator-b", now)).toBe(true);
  });
});
