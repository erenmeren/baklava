import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/mysql", () => ({
  listDatabases: vi.fn(async () => [{ name: "app" }]),
  listTables: vi.fn(async () => [{ name: "orders", kind: "table" }]),
  listColumns: vi.fn(async () => [{ name: "id" }]),
  getTableDDL: vi.fn(async () => "CREATE TABLE ..."),
  runReadOnlyQuery: vi.fn(async () => ({ fields: ["n"], rows: [[1]], rowCount: 1, durationMs: 1 })),
  createTable: vi.fn(async () => undefined),
  dropTable: vi.fn(async () => undefined),
}));

import * as my from "@/lib/connections/mysql";
import { mysqlTools } from "./mysql";

const cfg = { host: "h", port: 3306, database: "app", user: "u", password: "p", ssl: false };

describe("mysqlTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags categories", () => {
    const byName = Object.fromEntries(mysqlTools("c1", cfg).map((t) => [t.name, t.category]));
    expect(byName["mysql_run_sql"]).toBe("read");
    expect(byName["mysql_list_tables"]).toBe("read");
    expect(byName["mysql_create_table"]).toBe("write");
    expect(byName["mysql_drop_table"]).toBe("destructive");
  });

  it("mysql_run_sql delegates to runReadOnlyQuery", async () => {
    const t = mysqlTools("c1", cfg).find((x) => x.name === "mysql_run_sql")!;
    await t.execute({ database: "app", sql: "select 1" });
    expect(my.runReadOnlyQuery).toHaveBeenCalledWith(cfg, "app", "select 1", 1000);
  });

  it("mysql_drop_table delegates to dropTable", async () => {
    const t = mysqlTools("c1", cfg).find((x) => x.name === "mysql_drop_table")!;
    await t.execute({ database: "app", table: "orders" });
    expect(my.dropTable).toHaveBeenCalledWith(cfg, "app", "orders");
  });
});
