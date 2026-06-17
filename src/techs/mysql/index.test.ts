import { describe, it, expect } from "vitest";
import { mysql } from "./index";

describe("mysql module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(mysql.id).toBe("mysql");
    expect(mysql.optionalDeps).toEqual(["mysql2"]);
    expect(mysql.catalog.id).toBe("mysql");
    expect(mysql.serverPackages).toEqual(["mysql2"]);
  });
  it("summarises a connection record", () => {
    const summary = mysql.summary({
      id: "x", tech: "mysql", name: "n", status: "ok", createdAt: 0,
      config: { host: "h", port: 3306, database: "d", user: "u", password: "p", ssl: false },
    });
    expect(summary).toBe("u@h:3306/d");
  });
  it("exposes secret keys and a probe", () => {
    expect(mysql.config.secretKeys).toContain("password");
    expect(typeof mysql.driver.probe).toBe("function");
  });
});
