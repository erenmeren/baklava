import { describe, it, expect } from "vitest";
import { runReadOnlyQuery } from "./mysql";

const cfg = { host: "203.0.113.1", port: 1, database: "x", user: "u", password: "p", ssl: false };

describe("mysql runReadOnlyQuery guards", () => {
  it("rejects multi-statement injection before connecting", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "COMMIT; INSERT INTO t VALUES (1)")).rejects.toThrow(/must not contain/i);
  });
  it("lets a clean single statement through the guard (then fails to connect)", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "SELECT 1;")).rejects.not.toThrow(/must not contain/i);
  }, 20000);
});
