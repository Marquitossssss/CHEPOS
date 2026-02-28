import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("late payment resolve optimistic locking contract", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../../../../..");
  const read = (rel: string) => fs.readFileSync(path.resolve(repoRoot, rel), "utf8");

  it("uses version-based optimistic locking with increment", () => {
    const server = read("apps/api/src/server.ts");

    expect(server).toContain("version: lateCase.version");
    expect(server).toContain("version: { increment: 1 }");
    expect(server).toContain("late payment resolve conflict");
    expect(server).toContain("attemptedVersion: lateCase.version");
  });
});
