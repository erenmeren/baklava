import { describe, it, expect } from "vitest";
import { sqlserver } from "./index";

describe("sqlserver module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(sqlserver.id).toBe("sqlserver");
    expect(sqlserver.optionalDeps).toEqual(["mssql", "tedious"]);
    expect(sqlserver.catalog.id).toBe("sqlserver");
    expect(sqlserver.serverPackages).toEqual(["mssql", "tedious"]);
  });
  it("summarises a connection record", () => {
    const summary = sqlserver.summary({
      id: "x", tech: "sqlserver", name: "n", status: "ok", createdAt: 0,
      config: { host: "h", port: 1433, database: "d", user: "u", password: "p", encrypt: false, trustServerCertificate: false },
    });
    expect(summary).toBe("u@h:1433/d");
  });
  it("exposes secret keys and a probe", () => {
    expect(sqlserver.config.secretKeys).toContain("password");
    expect(typeof sqlserver.driver.probe).toBe("function");
  });
});
