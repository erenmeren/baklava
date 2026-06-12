import { describe, it, expect } from "vitest";
import { loadTestConfigSchema, requiredEnvVars } from "./schema";

describe("loadTestConfigSchema", () => {
  it("parses a minimal config and applies defaults", () => {
    const cfg = loadTestConfigSchema.parse({
      target: { baseUrl: "https://api.example.com" },
      requests: [{ name: "home", path: "/" }],
      profile: { type: "constant", vus: 5, duration: "10s" },
    });
    expect(cfg.name).toBe("loadtest");
    expect(cfg.auth).toEqual({ type: "none" });
    expect(cfg.requests[0].method).toBe("GET");
  });

  it("rejects an empty requests array", () => {
    expect(() =>
      loadTestConfigSchema.parse({
        target: { baseUrl: "https://x.test" },
        requests: [],
        profile: { type: "constant", vus: 1, duration: "1s" },
      }),
    ).toThrow();
  });

  it("rejects a non-URL baseUrl", () => {
    expect(() =>
      loadTestConfigSchema.parse({
        target: { baseUrl: "not-a-url" },
        requests: [{ name: "a", path: "/" }],
        profile: { type: "constant", vus: 1, duration: "1s" },
      }),
    ).toThrow();
  });

  it("rejects requests whose names map to the same metric key", () => {
    expect(() =>
      loadTestConfigSchema.parse({
        target: { baseUrl: "https://x.test" },
        requests: [
          { name: "Get Item", path: "/a" },
          { name: "get-item", path: "/b" },
        ],
        profile: { type: "constant", vus: 1, duration: "1s" },
      }),
    ).toThrow(/collides|metric/i);
  });

  it("accepts distinct request names", () => {
    expect(() =>
      loadTestConfigSchema.parse({
        target: { baseUrl: "https://x.test" },
        requests: [
          { name: "list", path: "/a" },
          { name: "create", path: "/b" },
        ],
        profile: { type: "constant", vus: 1, duration: "1s" },
      }),
    ).not.toThrow();
  });

  it("requiredEnvVars lists env names per auth type", () => {
    expect(requiredEnvVars({ type: "none" })).toEqual([]);
    expect(requiredEnvVars({ type: "bearer", tokenEnv: "TOK" })).toEqual(["TOK"]);
    expect(
      requiredEnvVars({ type: "basic", usernameEnv: "U", passwordEnv: "P" }),
    ).toEqual(["U", "P"]);
    expect(
      requiredEnvVars({ type: "apiKey", header: "X-Key", valueEnv: "K" }),
    ).toEqual(["K"]);
    expect(
      requiredEnvVars({ type: "customHeaders", headersEnv: { "X-A": "A", "X-B": "B" } }),
    ).toEqual(["A", "B"]);
  });
});
