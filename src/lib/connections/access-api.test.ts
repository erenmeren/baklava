import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Drive the connection list + access route handlers with constructed Requests +
// real session cookies for an admin, an owner (member who owns a conn), and a
// stranger (member with no grant). Every store caches on globalThis, so reset
// each slot between tests.
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
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-access-api-test-"));
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

type Users = typeof import("@/lib/auth/users");
type Session = typeof import("@/lib/auth/session");
type Store = typeof import("@/lib/connections/store");
type Access = typeof import("@/lib/connections/access");
type ListRoute = typeof import("@/app/api/connections/route");
type AccessRoute = typeof import("@/app/api/connections/[id]/access/route");
type ByIdRoute = typeof import("@/app/api/connections/[id]/route");

async function load() {
  const users = await import("@/lib/auth/users");
  users._resetUsersCacheForTests();
  const sessions = await import("@/lib/auth/sessions");
  sessions._resetSessionCacheForTests();
  const access = await import("@/lib/connections/access");
  access._resetAccessCacheForTests();
  const session = await import("@/lib/auth/session");
  const store = await import("@/lib/connections/store");
  const listRoute = await import("@/app/api/connections/route");
  const accessRoute = await import("@/app/api/connections/[id]/access/route");
  const byIdRoute = await import("@/app/api/connections/[id]/route");
  return {
    users: users as Users,
    session: session as Session,
    store: store as Store,
    access: access as Access,
    listRoute: listRoute as ListRoute,
    accessRoute: accessRoute as AccessRoute,
    byIdRoute: byIdRoute as ByIdRoute,
  };
}

function cookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function get(url: string, token?: string): Request {
  return new Request(url, {
    method: "GET",
    headers: token ? { cookie: cookie(token) } : {},
  });
}

/** The list route reads `req.nextUrl`, so it needs a real NextRequest. */
function nextGet(url: string, token?: string): NextRequest {
  return new NextRequest(url, {
    method: "GET",
    headers: token ? { cookie: cookie(token) } : {},
  });
}

function jsonReq(url: string, method: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.cookie = cookie(token);
  return new Request(url, { method, headers, body: JSON.stringify(body) });
}

/**
 * Seed an admin, an owner (member), and a stranger (member). The owner owns
 * `ownedConn`; nobody is granted anything yet.
 */
async function seed() {
  const ctx = await load();
  const admin = ctx.users.createUser({ username: "admin", password: "pw", role: "admin" });
  const owner = ctx.users.createUser({ username: "owner", password: "pw", role: "member" });
  const stranger = ctx.users.createUser({ username: "stranger", password: "pw", role: "member" });
  const adminToken = ctx.session.createSessionToken(admin.id);
  const ownerToken = ctx.session.createSessionToken(owner.id);
  const strangerToken = ctx.session.createSessionToken(stranger.id);
  const ownedConn = ctx.store.saveConnection({
    tech: "postgres",
    name: "owner-db",
    config: { host: "localhost", password: "secret" } as unknown as Record<string, unknown>,
    status: "untested",
    ownerId: owner.id,
  });
  return {
    ...ctx,
    admin,
    owner,
    stranger,
    adminToken,
    ownerToken,
    strangerToken,
    ownedConn,
  };
}

describe("GET /api/connections (per-user filtering)", () => {
  it("returns 401 without a session", async () => {
    const ctx = await seed();
    const res = await ctx.listRoute.GET(nextGet("http://localhost/api/connections"));
    expect(res.status).toBe(401);
  });

  it("admin sees every connection", async () => {
    const ctx = await seed();
    const res = await ctx.listRoute.GET(nextGet("http://localhost/api/connections", ctx.adminToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections.map((c: { id: string }) => c.id)).toContain(ctx.ownedConn.id);
  });

  it("owner sees their owned connection", async () => {
    const ctx = await seed();
    const res = await ctx.listRoute.GET(nextGet("http://localhost/api/connections", ctx.ownerToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections.map((c: { id: string }) => c.id)).toEqual([ctx.ownedConn.id]);
  });

  it("stranger sees no connection without a grant", async () => {
    const ctx = await seed();
    const res = await ctx.listRoute.GET(nextGet("http://localhost/api/connections", ctx.strangerToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toEqual([]);
  });

  it("stranger sees a connection once granted", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.ownedConn.id, { [ctx.stranger.id]: "read" });
    const res = await ctx.listRoute.GET(nextGet("http://localhost/api/connections", ctx.strangerToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections.map((c: { id: string }) => c.id)).toEqual([ctx.ownedConn.id]);
  });

  it("never leaks credentials in the list", async () => {
    const ctx = await seed();
    const res = await ctx.listRoute.GET(nextGet("http://localhost/api/connections", ctx.adminToken));
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("secret");
  });
});

describe("GET /api/connections/[id]/access", () => {
  it("403 for a stranger", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.GET(
      get(`http://localhost/api/connections/${ctx.ownedConn.id}/access`, ctx.strangerToken),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("200 for the owner", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.ownedConn.id, { [ctx.stranger.id]: "read" });
    const res = await ctx.accessRoute.GET(
      get(`http://localhost/api/connections/${ctx.ownedConn.id}/access`, ctx.ownerToken),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ownerId).toBe(ctx.owner.id);
    expect(body.ownerUsername).toBe("owner");
    expect(body.grants).toEqual([{ userId: ctx.stranger.id, username: "stranger", level: "read" }]);
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.length).toBe(3);
  });

  it("200 for an admin", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.GET(
      get(`http://localhost/api/connections/${ctx.ownedConn.id}/access`, ctx.adminToken),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(200);
  });

  it("404 for a missing connection", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.GET(
      get("http://localhost/api/connections/nope/access", ctx.adminToken),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
  });

  it("401 without a session", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.GET(
      get(`http://localhost/api/connections/${ctx.ownedConn.id}/access`),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(401);
  });

  it("does not return config", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.GET(
      get(`http://localhost/api/connections/${ctx.ownedConn.id}/access`, ctx.ownerToken),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("localhost");
  });
});

describe("PUT /api/connections/[id]/access", () => {
  it("sets grants (round-trips via getGrants)", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.PUT(
      jsonReq(
        `http://localhost/api/connections/${ctx.ownedConn.id}/access`,
        "PUT",
        { grants: { [ctx.stranger.id]: "write" } },
        ctx.ownerToken,
      ),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(ctx.access.getGrants(ctx.ownedConn.id)).toEqual({ [ctx.stranger.id]: "write" });
  });

  it("403 for a stranger", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.PUT(
      jsonReq(
        `http://localhost/api/connections/${ctx.ownedConn.id}/access`,
        "PUT",
        { grants: { [ctx.stranger.id]: "read" } },
        ctx.strangerToken,
      ),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("400 on an unknown userId", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.PUT(
      jsonReq(
        `http://localhost/api/connections/${ctx.ownedConn.id}/access`,
        "PUT",
        { grants: { ghost: "read" } },
        ctx.ownerToken,
      ),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("400 on a bad level", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.PUT(
      jsonReq(
        `http://localhost/api/connections/${ctx.ownedConn.id}/access`,
        "PUT",
        { grants: { [ctx.stranger.id]: "admin" } },
        ctx.ownerToken,
      ),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("404 for a missing connection", async () => {
    const ctx = await seed();
    const res = await ctx.accessRoute.PUT(
      jsonReq("http://localhost/api/connections/nope/access", "PUT", { grants: {} }, ctx.adminToken),
      { params: Promise.resolve({ id: "nope" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/connections/[id] drops grants", () => {
  it("clears the connection's grants", async () => {
    const ctx = await seed();
    ctx.access.setGrants(ctx.ownedConn.id, { [ctx.stranger.id]: "read" });
    expect(ctx.access.getGrants(ctx.ownedConn.id)).not.toEqual({});
    const res = await ctx.byIdRoute.DELETE(
      get(`http://localhost/api/connections/${ctx.ownedConn.id}`, ctx.ownerToken),
      { params: Promise.resolve({ id: ctx.ownedConn.id }) },
    );
    expect(res.status).toBe(200);
    expect(ctx.access.getGrants(ctx.ownedConn.id)).toEqual({});
  });
});
