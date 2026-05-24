import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

// Reset the store between tests.
function resetStore() {
  const sym = Symbol.for("baklava.connectionStore");
  delete (globalThis as Record<symbol, unknown>)[sym];
}

function postJson(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function postRaw(body: string): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    body,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-tech contract tests with mocked drivers — covers the shape contract:
//   400 on bad JSON / missing required fields
//   200 with { ok: true, ... } on driver success
//   200 with { ok: false, error } on driver failure (note: 200 not 500)
//   `save: true` persists, `save: false`/omitted does not
//   The returned `connection` is the redacted publicView (no plaintext password)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/postgres/test", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-pg-test-"));
    process.env.BAKLAVA_DATA_DIR = dataDir;
    resetStore();
    vi.resetModules();
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects malformed JSON with 400", async () => {
    const route = await import("./postgres/test/route");
    const res = await route.POST(postRaw("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/i);
  });

  it("rejects missing host or database with 400", async () => {
    const route = await import("./postgres/test/route");
    const r1 = await route.POST(postJson({ config: { database: "x" } }));
    expect(r1.status).toBe(400);
    const r2 = await route.POST(postJson({ config: { host: "x" } }));
    expect(r2.status).toBe(400);
  });

  it("returns ok:true and the probe payload on success", async () => {
    vi.doMock("@/lib/connections/postgres", () => ({
      probePostgres: vi.fn(async () => ({ version: "16.0", database: "d" })),
    }));
    const route = await import("./postgres/test/route");
    const res = await route.POST(
      postJson({
        name: "p",
        config: {
          host: "localhost",
          port: 5432,
          database: "d",
          user: "u",
          password: "p",
          ssl: false,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.probe.version).toBe("16.0");
    expect(body.connection).toBeNull(); // not saved
  });

  it("returns ok:false (status 200) and a formatted error when probe throws", async () => {
    vi.doMock("@/lib/connections/postgres", () => ({
      probePostgres: vi.fn(async () => {
        const err = Object.assign(new Error("connect refused"), {
          code: "ECONNREFUSED",
        });
        throw err;
      }),
    }));
    const route = await import("./postgres/test/route");
    const res = await route.POST(
      postJson({
        name: "p",
        config: {
          host: "x",
          port: 5432,
          database: "d",
          user: "u",
          password: "p",
          ssl: false,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("connect refused (ECONNREFUSED)");
  });

  it("with save:true persists the record and returns a redacted publicView", async () => {
    vi.doMock("@/lib/connections/postgres", () => ({
      probePostgres: vi.fn(async () => ({ version: "16" })),
    }));
    const route = await import("./postgres/test/route");
    const res = await route.POST(
      postJson({
        name: "Saved PG",
        save: true,
        config: {
          host: "h",
          port: 5432,
          database: "d",
          user: "u",
          password: "must-not-leak",
          ssl: false,
        },
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.connection).toBeTruthy();
    expect(body.connection.name).toBe("Saved PG");
    expect(body.connection.config.password).not.toBe("must-not-leak");
    expect(body.connection.config.password).toMatch(/^•+$/);
  });
});

describe("POST /api/docker/test (socket-style config)", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-dk-test-"));
    process.env.BAKLAVA_DATA_DIR = dataDir;
    resetStore();
    vi.resetModules();
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects request with no config", async () => {
    const route = await import("./docker/test/route");
    const res = await route.POST(postJson({}));
    expect(res.status).toBe(400);
  });

  it("returns ok:true with the info payload on success", async () => {
    vi.doMock("@/lib/connections/docker", () => ({
      pingDocker: vi.fn(async () => ({
        ServerVersion: "27.0",
        OperatingSystem: "linux",
        Containers: 5,
      })),
    }));
    const route = await import("./docker/test/route");
    const res = await route.POST(
      postJson({
        name: "d",
        config: { mode: "socket", socketPath: "/var/run/docker.sock" },
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.info.ServerVersion).toBe("27.0");
  });

  it("unwraps AggregateError when driver throws one", async () => {
    vi.doMock("@/lib/connections/docker", () => ({
      pingDocker: vi.fn(async () => {
        throw Object.assign(new Error(""), {
          name: "AggregateError",
          errors: [
            Object.assign(new Error("ipv6 connect failed"), {
              code: "ECONNREFUSED",
            }),
            Object.assign(new Error("ipv4 connect failed"), {
              code: "ECONNREFUSED",
            }),
          ],
        });
      }),
    }));
    const route = await import("./docker/test/route");
    const res = await route.POST(
      postJson({
        name: "d",
        config: { mode: "tcp", host: "x", port: 2375 },
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("ECONNREFUSED");
  });
});

describe("POST /api/kafka/test (nested SASL secret)", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-kf-test-"));
    process.env.BAKLAVA_DATA_DIR = dataDir;
    resetStore();
    vi.resetModules();
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("redacts the nested sasl.password when save:true", async () => {
    vi.doMock("@/lib/connections/kafka", () => ({
      probeKafka: vi.fn(async () => ({ brokers: 1, controllerId: 0 })),
    }));
    const route = await import("./kafka/test/route");
    const res = await route.POST(
      postJson({
        name: "K",
        save: true,
        config: {
          clientId: "baklava",
          brokers: ["localhost:9092"],
          ssl: false,
          sasl: {
            mechanism: "plain",
            username: "kafka",
            password: "kafka-must-not-leak",
          },
        },
      }),
    );
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.connection.config.sasl.password).not.toBe("kafka-must-not-leak");
    expect(body.connection.config.sasl.password).toMatch(/^•+$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Smoke matrix: every /api/<tech>/test route MUST reject malformed JSON
// with status 400. This is the cheapest possible coverage that every route
// (a) exists, (b) parses JSON before doing anything else, (c) follows the
// shared error envelope convention. If anyone adds a new tech and forgets
// the JSON guard, this fails immediately.
// ─────────────────────────────────────────────────────────────────────────────
const ALL_TECHS = ["docker", "kafka", "postgres", "sqlserver"];

describe("every /api/<tech>/test rejects malformed JSON", () => {
  it.each(ALL_TECHS)("%s returns 400 for invalid JSON body", async (tech) => {
    resetStore();
    vi.resetModules();
    const route = await import(`./${tech}/test/route.ts`);
    const res = await route.POST(postRaw("{not json"));
    expect(res.status).toBe(400);
  });
});
