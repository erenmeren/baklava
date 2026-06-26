import { describe, it, expect } from "vitest";
import { savedLoadTestConfigSchema } from "./store-schema";

const base = {
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", path: "/items" }],
  profile: { type: "constant", vus: 5, duration: "10s" },
};

describe("savedLoadTestConfigSchema", () => {
  it("parses a minimal config and defaults auth to none", () => {
    const cfg = savedLoadTestConfigSchema.parse(base);
    expect(cfg.auth).toEqual({ type: "none" });
    expect(cfg.requests[0].method).toBe("GET");
  });

  it("accepts literal-secret auth variants", () => {
    expect(savedLoadTestConfigSchema.parse({ ...base, auth: { type: "bearer", token: "t" } }).auth).toEqual({
      type: "bearer",
      token: "t",
    });
    expect(
      savedLoadTestConfigSchema.parse({ ...base, auth: { type: "apiKey", header: "X-Key", value: "v" } }).auth,
    ).toEqual({ type: "apiKey", header: "X-Key", value: "v" });
  });

  it("normalizes a scheme-less baseUrl and rejects a truly invalid one + empty requests", () => {
    expect(savedLoadTestConfigSchema.parse({ ...base, target: { baseUrl: "localhost:8080" } }).target.baseUrl)
      .toBe("http://localhost:8080");
    expect(() => savedLoadTestConfigSchema.parse({ ...base, target: { baseUrl: "no spaces allowed" } })).toThrow();
    expect(() => savedLoadTestConfigSchema.parse({ ...base, requests: [] })).toThrow();
  });

  it("rejects requests whose names collide on metric key", () => {
    expect(() =>
      savedLoadTestConfigSchema.parse({
        ...base,
        requests: [
          { name: "Get Item", path: "/a" },
          { name: "get-item", path: "/b" },
        ],
      }),
    ).toThrow(/collide|metric/i);
  });
});
