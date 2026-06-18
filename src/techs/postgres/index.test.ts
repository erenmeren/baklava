import { describe, it, expect } from "vitest";
import { postgres } from "./index";

describe("postgres module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(postgres.id).toBe("postgres");
    expect(postgres.optionalDeps).toEqual(["pg", "pg-cursor"]);
    expect(postgres.catalog.id).toBe("postgres");
    expect(postgres.serverPackages).toEqual(["pg", "pg-cursor"]);
  });
  it("summarises a connection record", () => {
    const summary = postgres.summary({
      id: "x", tech: "postgres", name: "n", status: "ok", createdAt: 0,
      config: { host: "h", port: 5432, database: "d", user: "u", password: "p", ssl: false },
    });
    expect(summary).toBe("u@h:5432/d");
  });
  it("exposes secret keys and a probe", () => {
    expect(postgres.config.secretKeys).toContain("password");
    expect(typeof postgres.driver.probe).toBe("function");
  });
});
