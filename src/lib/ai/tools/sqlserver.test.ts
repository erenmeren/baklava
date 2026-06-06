import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/sqlserver", () => ({
  listSqlServerDatabases: vi.fn(async () => [{ name: "app" }]),
  listSqlServerObjects: vi.fn(async () => [{ schema: "dbo", name: "Orders", kind: "table" }]),
  getSqlServerTableDetail: vi.fn(async () => ({ columns: [], indexes: [] })),
  runReadOnlyQuery: vi.fn(async () => ({ fields: ["n"], rows: [[1]], rowCount: 1 })),
  createSqlServerTable: vi.fn(async () => undefined),
  dropSqlServerObject: vi.fn(async () => undefined),
}));

import * as ms from "@/lib/connections/sqlserver";
import { mssqlTools } from "./sqlserver";

const cfg = { host: "h", port: 1433, database: "app", user: "u", password: "p", encrypt: false, trustServerCertificate: true };

describe("mssqlTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags categories", () => {
    const byName = Object.fromEntries(mssqlTools("c1", cfg).map((t) => [t.name, t.category]));
    expect(byName["mssql_run_sql"]).toBe("read");
    expect(byName["mssql_list_objects"]).toBe("read");
    expect(byName["mssql_create_table"]).toBe("write");
    expect(byName["mssql_drop_object"]).toBe("destructive");
  });

  it("mssql_run_sql delegates to runReadOnlyQuery", async () => {
    const t = mssqlTools("c1", cfg).find((x) => x.name === "mssql_run_sql")!;
    await t.execute({ database: "app", sql: "select 1" });
    expect(ms.runReadOnlyQuery).toHaveBeenCalledWith(cfg, "app", "select 1", 1000);
  });

  it("mssql_drop_object delegates to dropSqlServerObject", async () => {
    const t = mssqlTools("c1", cfg).find((x) => x.name === "mssql_drop_object")!;
    await t.execute({ database: "app", schema: "dbo", name: "Orders", kind: "table" });
    expect(ms.dropSqlServerObject).toHaveBeenCalledWith(cfg, "app", { schema: "dbo", name: "Orders", kind: "table" });
  });
});
