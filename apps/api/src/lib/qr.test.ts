import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "x".repeat(24);
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "y".repeat(24);
  process.env.QR_SECRET = process.env.QR_SECRET ?? "z".repeat(24);
});

describe("qr", () => {
  it("genera y verifica código firmado", async () => {
    const { generateTicketCode, verifyTicketCode } = await import("./qr.js");

    const code = generateTicketCode("ticket-id");
    expect(verifyTicketCode(code)).toBe(true);
    expect(verifyTicketCode(`${code}x`)).toBe(false);
  });
});
