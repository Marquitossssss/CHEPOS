import { describe, expect, it } from "vitest";
import { generateTicketCode, verifyTicketCode } from "./qr.js";

describe("qr", () => {
  it("genera y verifica código firmado", () => {
    const code = generateTicketCode("ticket-id");
    expect(verifyTicketCode(code)).toBe(true);
    expect(verifyTicketCode(`${code}x`)).toBe(false);
  });
});
