import { describe, it, expect } from "vitest";
import { buildTools } from "./registry";
import { DEFAULT_POLICY } from "../permissions";

const pgCfg = { host: "h", port: 5432, database: "app", user: "u", password: "p", ssl: false };

describe("buildTools", () => {
  it("with default (read-only) policy, exposes only read tools", () => {
    const names = buildTools("postgres", "c1", pgCfg, DEFAULT_POLICY).map((t) => t.name);
    expect(names).toContain("pg_run_sql");
    expect(names).not.toContain("pg_create_table");
    expect(names).not.toContain("pg_drop_table");
  });

  it("with write enabled, exposes write tools but not destructive", () => {
    const names = buildTools("postgres", "c1", pgCfg, {
      ...DEFAULT_POLICY,
      write: true,
    }).map((t) => t.name);
    expect(names).toContain("pg_create_table");
    expect(names).not.toContain("pg_drop_table");
  });

  it("returns [] for an unsupported tech in Phase 1", () => {
    expect(buildTools("kafka", "c1", pgCfg, DEFAULT_POLICY)).toEqual([]);
  });
});

describe("buildTools — sql family", () => {
  const myCfg = { host: "h", port: 3306, database: "app", user: "u", password: "p", ssl: false };
  const msCfg = { host: "h", port: 1433, database: "app", user: "u", password: "p", encrypt: false, trustServerCertificate: true };
  it("exposes mysql read tools under default policy", () => {
    const names = buildTools("mysql", "c1", myCfg, DEFAULT_POLICY).map((t) => t.name);
    expect(names).toContain("mysql_run_sql");
    expect(names).not.toContain("mysql_drop_table");
  });
  it("exposes sqlserver read tools under default policy", () => {
    const names = buildTools("sqlserver", "c1", msCfg, DEFAULT_POLICY).map((t) => t.name);
    expect(names).toContain("mssql_run_sql");
    expect(names).not.toContain("mssql_drop_object");
  });
});
