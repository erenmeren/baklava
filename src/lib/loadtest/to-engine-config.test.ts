import { describe, it, expect } from "vitest";
import { toEngineConfig } from "./to-engine-config";
import { savedLoadTestConfigSchema } from "./store-schema";

function parse(authPart: object) {
  return savedLoadTestConfigSchema.parse({
    target: { baseUrl: "https://api.example.com" },
    requests: [{ name: "list", path: "/items" }],
    profile: { type: "constant", vus: 1, duration: "1s" },
    ...authPart,
  });
}

describe("toEngineConfig", () => {
  it("passes through non-secret fields and sets the name", () => {
    const { config, env } = toEngineConfig(parse({}), "My Test");
    expect(config.name).toBe("My Test");
    expect(config.target.baseUrl).toBe("https://api.example.com");
    expect(config.requests).toHaveLength(1);
    expect(config.auth).toEqual({ type: "none" });
    expect(env).toEqual({});
  });

  it("maps bearer to env-name auth + env map", () => {
    const { config, env } = toEngineConfig(parse({ auth: { type: "bearer", token: "abc" } }), "t");
    expect(config.auth).toEqual({ type: "bearer", tokenEnv: "LT_BEARER" });
    expect(env).toEqual({ LT_BEARER: "abc" });
  });

  it("maps basic to two env vars", () => {
    const { config, env } = toEngineConfig(
      parse({ auth: { type: "basic", username: "u", password: "p" } }),
      "t",
    );
    expect(config.auth).toEqual({
      type: "basic",
      usernameEnv: "LT_BASIC_USER",
      passwordEnv: "LT_BASIC_PASS",
    });
    expect(env).toEqual({ LT_BASIC_USER: "u", LT_BASIC_PASS: "p" });
  });

  it("maps apiKey preserving the header name", () => {
    const { config, env } = toEngineConfig(
      parse({ auth: { type: "apiKey", header: "X-Api-Key", value: "k" } }),
      "t",
    );
    expect(config.auth).toEqual({ type: "apiKey", header: "X-Api-Key", valueEnv: "LT_APIKEY" });
    expect(env).toEqual({ LT_APIKEY: "k" });
  });

  it("maps customHeaders to indexed env vars (collision-free)", () => {
    const { config, env } = toEngineConfig(
      parse({ auth: { type: "customHeaders", headers: { "X-A": "1", "X-B": "2" } } }),
      "t",
    );
    expect(config.auth).toEqual({
      type: "customHeaders",
      headersEnv: { "X-A": "LT_CUSTOM_0", "X-B": "LT_CUSTOM_1" },
    });
    expect(env).toEqual({ LT_CUSTOM_0: "1", LT_CUSTOM_1: "2" });
  });
});
