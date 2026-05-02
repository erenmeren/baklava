import { describe, it, expect } from "vitest";
import { postgresPlugin } from "../../lib/sources/postgres";
import type { ConnectionConfig } from "../../lib/sources/types";

const goodConfig: ConnectionConfig = {
  name: "pg-local",
  plugin: "postgres",
  config: {
    host: "localhost",
    port: 5432,
    database: "app",
    user: "postgres",
    password: "secret",
    ssl: false,
    schema: "public",
  },
};

describe("postgresPlugin.validateConfig", () => {
  it("accepts a fully-formed config", () => {
    expect(() => postgresPlugin.validateConfig(goodConfig)).not.toThrow();
  });

  it("rejects a config missing host", () => {
    const bad = {
      ...goodConfig,
      config: { ...goodConfig.config, host: undefined as unknown as string },
    };
    expect(() => postgresPlugin.validateConfig(bad)).toThrow(/host/i);
  });

  it("rejects a config missing database", () => {
    const bad = {
      ...goodConfig,
      config: { ...goodConfig.config, database: undefined as unknown as string },
    };
    expect(() => postgresPlugin.validateConfig(bad)).toThrow(/database/i);
  });

  it("rejects a config missing user", () => {
    const bad = {
      ...goodConfig,
      config: { ...goodConfig.config, user: undefined as unknown as string },
    };
    expect(() => postgresPlugin.validateConfig(bad)).toThrow(/user/i);
  });

  it("rejects a config missing password", () => {
    const bad = {
      ...goodConfig,
      config: { ...goodConfig.config, password: undefined as unknown as string },
    };
    expect(() => postgresPlugin.validateConfig(bad)).toThrow(/password/i);
  });

  it("rejects an empty-string field", () => {
    const bad = { ...goodConfig, config: { ...goodConfig.config, host: "" } };
    expect(() => postgresPlugin.validateConfig(bad)).toThrow(/host/i);
  });
});

// We don't run a full integration test against a real Postgres server here —
// that lives in tests/integration/ behind a docker-compose harness. The unit
// tests above cover the validateConfig surface, which is the most user-facing
// failure mode.
