import { describe, it, expect } from "vitest";
import { redis } from "./index";

describe("redis module", () => {
  it("declares id, optionalDeps and catalog", () => {
    expect(redis.id).toBe("redis");
    expect(redis.optionalDeps).toEqual(["ioredis"]);
    expect(redis.catalog.id).toBe("redis");
    expect(redis.serverPackages).toEqual(["ioredis"]);
  });
  it("summarises a connection record", () => {
    const summary = redis.summary({
      id: "x", tech: "redis", name: "n", status: "ok", createdAt: 0,
      config: { mode: "single", host: "h", port: 6379, tls: false },
    });
    expect(summary).toBe("redis://h:6379");
  });
  it("exposes secret keys and a probe", () => {
    expect(redis.config.secretKeys).toContain("password");
    expect(typeof redis.driver.probe).toBe("function");
  });
});
