import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/postgres", () => ({
  listDatabases: vi.fn(async () => [{ name: "app" }]),
  listAllRelations: vi.fn(async () => [{ schema: "public", name: "orders", kind: "table", columns: ["id"], isSystem: false }]),
  listColumns: vi.fn(async () => [{ name: "id", dataType: "int4" }]),
  getTableDDL: vi.fn(async () => "CREATE TABLE ..."),
  runReadOnlyQuery: vi.fn(async () => ({ fields: ["sum"], rows: [[42]], rowCount: 1, durationMs: 1 })),
  createTable: vi.fn(async () => undefined),
  dropTable: vi.fn(async () => undefined),
}));

import * as pg from "@/lib/connections/postgres";
import { pgTools } from "./postgres";

const cfg = { host: "h", port: 5432, database: "app", user: "u", password: "p", ssl: false };

describe("pgTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags categories correctly", () => {
    const byName = Object.fromEntries(pgTools("c1", cfg).map((t) => [t.name, t.category]));
    expect(byName["pg_run_sql"]).toBe("read");
    expect(byName["pg_list_tables"]).toBe("read");
    expect(byName["pg_create_table"]).toBe("write");
    expect(byName["pg_drop_table"]).toBe("destructive");
  });

  it("pg_run_sql delegates to runReadOnlyQuery", async () => {
    const tool = pgTools("c1", cfg).find((t) => t.name === "pg_run_sql")!;
    const out = await tool.execute({ database: "app", sql: "select sum(total) from orders" });
    expect(pg.runReadOnlyQuery).toHaveBeenCalledWith(cfg, "app", "select sum(total) from orders", 1000);
    expect(out).toMatchObject({ rows: [[42]] });
  });

  it("pg_drop_table delegates to dropTable", async () => {
    const tool = pgTools("c1", cfg).find((t) => t.name === "pg_drop_table")!;
    await tool.execute({ database: "app", schema: "public", table: "orders" });
    expect(pg.dropTable).toHaveBeenCalledWith(cfg, "app", "public", "orders", { cascade: false });
  });
});
