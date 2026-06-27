import { describe, it, expect } from "vitest";
import { scoreAction } from "./risk";

describe("scoreAction", () => {
  it("reads are low risk", () => {
    expect(scoreAction("pg_list_tables", "read", {}).level).toBe("low");
  });

  it("writes are medium risk", () => {
    const r = scoreAction("redis_set_string", "write", { key: "k" });
    expect(r.level).toBe("medium");
  });

  it("destructive is at least high risk", () => {
    const r = scoreAction("pg_drop_table", "destructive", { table: "orders" });
    expect(r.level).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/destructive/i);
  });

  it("flags a destructive SQL statement with no WHERE clause", () => {
    const r = scoreAction("mysql_run_sql", "destructive", { sql: "DELETE FROM users" });
    expect(r.level).toBe("high");
    expect(r.reasons.join(" ")).toMatch(/where/i);
  });

  it("does not flag a WHERE-scoped statement for the no-filter reason", () => {
    const r = scoreAction("mysql_run_sql", "destructive", { sql: "DELETE FROM users WHERE id = 1" });
    expect(r.reasons.join(" ")).not.toMatch(/no where/i);
  });

  it("flags a wildcard argument", () => {
    const r = scoreAction("blob_delete_objects", "destructive", { prefix: "*" });
    expect(r.reasons.join(" ")).toMatch(/wildcard/i);
  });
});
