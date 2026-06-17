import { describe, it, expect } from "vitest";
import { mongo } from "./index";

describe("mongo module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(mongo.id).toBe("mongo");
    expect(mongo.optionalDeps).toEqual(["mongodb", "bson"]);
    expect(mongo.catalog.id).toBe("mongo");
    expect(mongo.serverPackages).toEqual(["mongodb"]);
  });
  it("summarises a connection record", () => {
    const summary = mongo.summary({
      id: "x", tech: "mongo", name: "n", status: "ok", createdAt: 0,
      config: { uri: "mongodb://user:pass@host:27017" },
    });
    expect(summary).toBe("mongodb://host:27017");
  });
  it("exposes secret keys and a probe", () => {
    expect(mongo.config.secretKeys).toContain("uri");
    expect(typeof mongo.driver.probe).toBe("function");
  });
});
