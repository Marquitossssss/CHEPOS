import crypto from "node:crypto";
import { env } from "./env.js";

export function generateTicketCode(seed: string) {
  const nonce = crypto.randomBytes(12).toString("hex");
  const payload = `${seed}.${nonce}`;
  const sig = crypto.createHmac("sha256", env.qrSecret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyTicketCode(code: string) {
  const parts = code.split(".");
  if (parts.length !== 3) return false;

  const [seed, nonce, signature] = parts;
  if (!seed || !nonce || !/^[a-f0-9]{64}$/i.test(signature)) return false;

  const payload = `${seed}.${nonce}`;
  const expected = crypto.createHmac("sha256", env.qrSecret).update(payload).digest("hex");
  if (expected.length !== signature.length) return false;

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
