import { describe, it, expect } from "vitest";
import { runReadOnlyQuery } from "./sqlserver";

const cfg = { host: "203.0.113.1", port: 1, database: "x", user: "u", password: "p", encrypt: false, trustServerCertificate: true };

describe("sqlserver runReadOnlyQuery guards", () => {
  it("rejects multi-statement injection before connecting", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "SELECT 1; DROP TABLE t")).rejects.toThrow(/Read-only query rejected/i);
  });
  it("rejects a write-keyword statement before connecting", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "DELETE FROM t")).rejects.toThrow(/read-only/i);
    await expect(runReadOnlyQuery(cfg, "x", "UPDATE t SET a=1")).rejects.toThrow(/read-only/i);
    await expect(runReadOnlyQuery(cfg, "x", "SELECT * INTO t2 FROM t")).rejects.toThrow(/read-only/i);
  });
  it("lets a clean SELECT through the guards (then fails to connect)", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "SELECT 1")).rejects.not.toThrow(/Read-only query rejected/i);
  }, 20000);
});
