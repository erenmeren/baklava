import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// `dashboard` is not a tech id, so the proxy's connection-scoped path matcher
// historically did not cover this route — making it a none-access boundary
// break (any member could probe any connection's health). These tests assert
// the handler-level RBAC: stranger → 404 (hide existence), owner/admin/reader →
// 200. probeHealth is mocked so we never touch the network; everything else
// (users, sessions, connections, access grants) is the real store seeded on disk.
vi.mock("@/lib/connections/health", () => ({ probeHealth: vi.fn() }));

const AUTH_CACHE = Symbol.for("baklava.authState");
const USERS_CACHE = Symbol.for("baklava.usersStore");
const SESSION_CACHE = Symbol.for("baklava.sessionStore");
const CONN_CACHE = Symbol.for("baklava.connectionStore");
const ACCESS_CACHE = Symbol.for("baklava.connectionAccess");

const SESSION_COOKIE_NAME = "baklava_session";

function resetCaches() {
  const g = globalThis as Record<symbol, unknown>;
  delete g[AUTH_CACHE];
  delete g[USERS_CACHE];
  delete g[SESSION_CACHE];
  delete g[CONN_CACHE];
  delete g[ACCESS_CACHE];
}

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-dashboard-health-test-"));
  process.env.BAKLAVA_DATA_DIR = TMP;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
  resetCaches();
});

afterEach(() => {
  resetCaches();
  vi.clearAllMocks();
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function load() {
  const users = await import("@/lib/auth/users");
  users._resetUsersCacheForTests();
  const sessions = await import("@/lib/auth/sessions");
  sessions._resetSessionCacheForTests();
  const access = await import("@/lib/connections/access");
  access._resetAccessCacheForTests();
  const session = await import("@/lib/auth/session");
  const store = await import("@/lib/connections/store");
  const health = await import("@/lib/connections/health");
  const route = await import("./route");
  return { users, sessions, access, session, store, health, route };
}

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function get(url: string, token?: string): Request {
  return new Request(url, { method: "GET", headers: token ? { cookie: cookie(token) } : {} });
}

async function seed() {
  const ctx = await load();
  const admin = ctx.users.createUser({ username: "admin", password: "pw", role: "admin" });
  const owner = ctx.users.createUser({ username: "owner", password: "pw", role: "member" });
  const stranger = ctx.users.createUser({ username: "stranger", password: "pw", role: "member" });
  const reader = ctx.users.createUser({ username: "reader", password: "pw", role: "member" });
  const adminToken = ctx.session.createSessionToken(admin.id);
  const ownerToken = ctx.session.createSessionToken(owner.id);
  const strangerToken = ctx.session.createSessionToken(stranger.id);
  const readerToken = ctx.session.createSessionToken(reader.id);
  const conn = ctx.store.saveConnection({
    tech: "postgres",
    name: "owner-db",
    config: { host: "localhost", password: "secret" } as unknown as Record<string, unknown>,
    status: "untested",
    ownerId: owner.id,
  });
  ctx.access.setGrants(conn.id, { [reader.id]: "read" });
  vi.mocked(ctx.health.probeHealth).mockResolvedValue({
    status: "ok",
    latencyMs: 9,
    summary: "x",
    metrics: [],
  } as never);
  return { ...ctx, admin, owner, stranger, reader, adminToken, ownerToken, strangerToken, readerToken, conn };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/dashboard/[id]/health (RBAC)", () => {
  it("unauthenticated → 401", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(get(`http://localhost/api/dashboard/${ctx.conn.id}/health`), params(ctx.conn.id));
    expect(res.status).toBe(401);
    expect(ctx.health.probeHealth).not.toHaveBeenCalled();
  });

  it("member with NO grant on another's connection → 404 (hide existence)", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(
      get(`http://localhost/api/dashboard/${ctx.conn.id}/health`, ctx.strangerToken),
      params(ctx.conn.id),
    );
    expect(res.status).toBe(404);
    // Critically: we must NOT have probed the connection for a no-access user.
    expect(ctx.health.probeHealth).not.toHaveBeenCalled();
  });

  it("owner → 200", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(
      get(`http://localhost/api/dashboard/${ctx.conn.id}/health`, ctx.ownerToken),
      params(ctx.conn.id),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", latencyMs: 9 });
  });

  it("admin → 200", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(
      get(`http://localhost/api/dashboard/${ctx.conn.id}/health`, ctx.adminToken),
      params(ctx.conn.id),
    );
    expect(res.status).toBe(200);
  });

  it("member with a read grant → 200", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(
      get(`http://localhost/api/dashboard/${ctx.conn.id}/health`, ctx.readerToken),
      params(ctx.conn.id),
    );
    expect(res.status).toBe(200);
  });

  it("unknown connection → 404", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(
      get("http://localhost/api/dashboard/nope/health", ctx.adminToken),
      params("nope"),
    );
    expect(res.status).toBe(404);
  });
});
