import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Handler-level RBAC checks for GET/PATCH/DELETE on a single connection.
// Even with the proxy guard in front, the route must be correct in isolation:
// stranger GET → 404 (hide existence), stranger PATCH/DELETE → 403, read-only
// grant PATCH/DELETE → 403 (write required), owner/admin → ok.
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
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-byid-route-test-"));
  process.env.BAKLAVA_DATA_DIR = TMP;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
  resetCaches();
});

afterEach(() => {
  resetCaches();
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
  const route = await import("./route");
  return { users, access, session, store, route };
}

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function get(url: string, token?: string): Request {
  return new Request(url, { method: "GET", headers: token ? { cookie: cookie(token) } : {} });
}

function jsonReq(url: string, method: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.cookie = cookie(token);
  return new Request(url, { method, headers, body: JSON.stringify(body) });
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
  return { ...ctx, admin, owner, stranger, reader, adminToken, ownerToken, strangerToken, readerToken, conn };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/connections/[id]", () => {
  it("owner gets the connection", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.ownerToken), params(ctx.conn.id));
    expect(res.status).toBe(200);
  });

  it("admin gets the connection", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.adminToken), params(ctx.conn.id));
    expect(res.status).toBe(200);
  });

  it("reader (read grant) gets the connection", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.readerToken), params(ctx.conn.id));
    expect(res.status).toBe(200);
  });

  it("stranger → 404 (hide existence)", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.strangerToken), params(ctx.conn.id));
    expect(res.status).toBe(404);
  });

  it("missing connection → 404", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(get("http://localhost/api/connections/nope", ctx.adminToken), params("nope"));
    expect(res.status).toBe(404);
  });

  it("never leaks credentials", async () => {
    const ctx = await seed();
    const res = await ctx.route.GET(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.adminToken), params(ctx.conn.id));
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("secret");
  });
});

describe("PATCH /api/connections/[id]", () => {
  it("owner can patch", async () => {
    const ctx = await seed();
    const res = await ctx.route.PATCH(
      jsonReq(`http://localhost/api/connections/${ctx.conn.id}`, "PATCH", { name: "renamed" }, ctx.ownerToken),
      params(ctx.conn.id),
    );
    expect(res.status).toBe(200);
  });

  it("admin can patch", async () => {
    const ctx = await seed();
    const res = await ctx.route.PATCH(
      jsonReq(`http://localhost/api/connections/${ctx.conn.id}`, "PATCH", { name: "renamed" }, ctx.adminToken),
      params(ctx.conn.id),
    );
    expect(res.status).toBe(200);
  });

  it("stranger → 403", async () => {
    const ctx = await seed();
    const res = await ctx.route.PATCH(
      jsonReq(`http://localhost/api/connections/${ctx.conn.id}`, "PATCH", { name: "x" }, ctx.strangerToken),
      params(ctx.conn.id),
    );
    expect(res.status).toBe(403);
  });

  it("read-only grant → 403 (write required)", async () => {
    const ctx = await seed();
    const res = await ctx.route.PATCH(
      jsonReq(`http://localhost/api/connections/${ctx.conn.id}`, "PATCH", { name: "x" }, ctx.readerToken),
      params(ctx.conn.id),
    );
    expect(res.status).toBe(403);
  });

  it("missing connection → 404", async () => {
    const ctx = await seed();
    const res = await ctx.route.PATCH(
      jsonReq("http://localhost/api/connections/nope", "PATCH", { name: "x" }, ctx.adminToken),
      params("nope"),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/connections/[id]", () => {
  it("owner can delete", async () => {
    const ctx = await seed();
    const res = await ctx.route.DELETE(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.ownerToken), params(ctx.conn.id));
    expect(res.status).toBe(200);
    expect(ctx.store.getConnection(ctx.conn.id)).toBeUndefined();
  });

  it("admin can delete", async () => {
    const ctx = await seed();
    const res = await ctx.route.DELETE(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.adminToken), params(ctx.conn.id));
    expect(res.status).toBe(200);
  });

  it("stranger → 403", async () => {
    const ctx = await seed();
    const res = await ctx.route.DELETE(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.strangerToken), params(ctx.conn.id));
    expect(res.status).toBe(403);
    expect(ctx.store.getConnection(ctx.conn.id)).toBeDefined();
  });

  it("read-only grant → 403 (write required)", async () => {
    const ctx = await seed();
    const res = await ctx.route.DELETE(get(`http://localhost/api/connections/${ctx.conn.id}`, ctx.readerToken), params(ctx.conn.id));
    expect(res.status).toBe(403);
  });

  it("missing connection → 404", async () => {
    const ctx = await seed();
    const res = await ctx.route.DELETE(get("http://localhost/api/connections/nope", ctx.adminToken), params("nope"));
    expect(res.status).toBe(404);
  });
});
