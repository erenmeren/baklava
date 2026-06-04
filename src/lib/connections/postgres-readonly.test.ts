import { describe, it, expect } from "vitest";
import { runReadOnlyQuery } from "./postgres";

const cfg = { host: "203.0.113.1", port: 1, database: "x", user: "u", password: "p", ssl: false };

describe("runReadOnlyQuery multi-statement guard", () => {
  it("rejects multi-statement injection before connecting", async () => {
    await expect(
      runReadOnlyQuery(cfg, "x", "COMMIT; INSERT INTO victim VALUES (1)"),
    ).rejects.toThrow(/cannot contain/i);
  });
  it("rejects a DROP smuggled after COMMIT", async () => {
    await expect(
      runReadOnlyQuery(cfg, "x", "SELECT 1; COMMIT; DROP TABLE victim"),
    ).rejects.toThrow(/cannot contain/i);
  });
  it("allows a single statement with a trailing semicolon (guard strips it, then would connect)", async () => {
    // A clean single statement passes the guard; it then tries to connect to a
    // bogus host and fails with a CONNECTION error (NOT the terminator error),
    // proving the guard let it through.
    await expect(
      runReadOnlyQuery(cfg, "x", "SELECT 1;"),
    ).rejects.not.toThrow(/cannot contain/i);
  }, 20000);
});
