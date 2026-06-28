import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Drive the user-management route handlers with constructed Requests + a real
// session cookie. The users store, session store, auth secret, and connection
// store all cache on globalThis, so reset every slot between tests.
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
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-users-api-test-"));
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

type Users = typeof import("./users");
type Session = typeof import("./session");
type CurrentUser = typeof import("./current-user");
type Store = typeof import("@/lib/connections/store");
type Collection = typeof import("@/app/api/users/route");
type ById = typeof import("@/app/api/users/[id]/route");
type Me = typeof import("@/app/api/users/me/route");

async function load() {
  const users = await import("./users");
  users._resetUsersCacheForTests();
  const sessions = await import("./sessions");
  sessions._resetSessionCacheForTests();
  const session = await import("./session");
  const cu = await import("./current-user");
  const store = await import("@/lib/connections/store");
  const collection = await import("@/app/api/users/route");
  const byId = await import("@/app/api/users/[id]/route");
  const me = await import("@/app/api/users/me/route");
  return {
    users: users as Users,
    session: session as Session,
    cu: cu as CurrentUser,
    store: store as Store,
    collection: collection as Collection,
    byId: byId as ById,
    me: me as Me,
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

function jsonReq(url: string, method: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.cookie = cookie(token);
  return new Request(url, { method, headers, body: JSON.stringify(body) });
}

/** Seed an admin + member and return tokens for each. */
async function seed() {
  const ctx = await load();
  const admin = ctx.users.createUser({ username: "admin", password: "pw", role: "admin" });
  const member = ctx.users.createUser({ username: "bob", password: "pw", role: "member" });
  const adminToken = ctx.session.createSessionToken(admin.id);
  const memberToken = ctx.session.createSessionToken(member.id);
  return { ...ctx, admin, member, adminToken, memberToken };
}

describe("GET /api/users", () => {
  it("returns 401 without a session", async () => {
    const ctx = await seed();
    const res = await ctx.collection.GET(get("http://localhost/api/users"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for a member", async () => {
    const ctx = await seed();
    const res = await ctx.collection.GET(get("http://localhost/api/users", ctx.memberToken));
    expect(res.status).toBe(403);
  });

  it("lists users without exposing hashes", async () => {
    const ctx = await seed();
    const res = await ctx.collection.GET(get("http://localhost/api/users", ctx.adminToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users.length).toBe(2);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("salt");
    for (const u of body.users) {
      expect(u.passwordHash).toBeUndefined();
      expect(u.salt).toBeUndefined();
    }
  });
});

describe("POST /api/users", () => {
  it("returns 403 for a member", async () => {
    const ctx = await seed();
    const res = await ctx.collection.POST(
      jsonReq("http://localhost/api/users", "POST", { username: "x", password: "pw", role: "member" }, ctx.memberToken),
    );
    expect(res.status).toBe(403);
  });

  it("creates a user and returns a PublicUser", async () => {
    const ctx = await seed();
    const res = await ctx.collection.POST(
      jsonReq("http://localhost/api/users", "POST", { username: "carol", password: "pw", role: "member" }, ctx.adminToken),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.username).toBe("carol");
    expect(body.user.role).toBe("member");
    expect(body.user.passwordHash).toBeUndefined();
    expect(body.user.salt).toBeUndefined();
    expect(ctx.users.getUserByUsername("carol")).not.toBeNull();
  });

  it("rejects an empty password with 400", async () => {
    const ctx = await seed();
    const res = await ctx.collection.POST(
      jsonReq("http://localhost/api/users", "POST", { username: "carol", password: "", role: "member" }, ctx.adminToken),
    );
    expect(res.status).toBe(400);
  });

  it("maps a duplicate username to 409", async () => {
    const ctx = await seed();
    const res = await ctx.collection.POST(
      jsonReq("http://localhost/api/users", "POST", { username: "bob", password: "pw", role: "member" }, ctx.adminToken),
    );
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/users/[id]", () => {
  it("returns 403 for a member", async () => {
    const ctx = await seed();
    const res = await ctx.byId.PATCH(
      jsonReq(`http://localhost/api/users/${ctx.member.id}`, "PATCH", { role: "admin" }, ctx.memberToken),
      { params: Promise.resolve({ id: ctx.member.id }) },
    );
    expect(res.status).toBe(403);
  });

  it("maps demoting the last admin to 409", async () => {
    const ctx = await seed();
    const res = await ctx.byId.PATCH(
      jsonReq(`http://localhost/api/users/${ctx.admin.id}`, "PATCH", { role: "member" }, ctx.adminToken),
      { params: Promise.resolve({ id: ctx.admin.id }) },
    );
    expect(res.status).toBe(409);
  });

  it("revokes the target's sessions on a role change", async () => {
    const ctx = await seed();
    // member is currently signed in via memberToken
    expect(ctx.session.verifySessionToken(ctx.memberToken)).toBe(true);
    const res = await ctx.byId.PATCH(
      jsonReq(`http://localhost/api/users/${ctx.member.id}`, "PATCH", { role: "admin" }, ctx.adminToken),
      { params: Promise.resolve({ id: ctx.member.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.role).toBe("admin");
    // the target's old token must no longer verify
    expect(ctx.session.verifySessionToken(ctx.memberToken)).toBe(false);
  });
});

describe("DELETE /api/users/[id]", () => {
  it("blocks deleting yourself with 400", async () => {
    const ctx = await seed();
    const res = await ctx.byId.DELETE(
      get(`http://localhost/api/users/${ctx.admin.id}`, ctx.adminToken),
      { params: Promise.resolve({ id: ctx.admin.id }) },
    );
    expect(res.status).toBe(400);
    expect(ctx.users.getUserById(ctx.admin.id)).not.toBeNull();
  });

  it("deletes a non-last admin successfully (guard does not misfire)", async () => {
    const ctx = await seed();
    const admin2 = ctx.users.createUser({ username: "root", password: "pw", role: "admin" });
    const res = await ctx.byId.DELETE(
      get(`http://localhost/api/users/${admin2.id}`, ctx.adminToken),
      { params: Promise.resolve({ id: admin2.id }) },
    );
    // Two enabled admins exist → removing one leaves a valid console → 200.
    expect(res.status).toBe(200);
    expect(ctx.users.getUserById(admin2.id)).toBeNull();
    expect(ctx.users.countAdmins()).toBe(1);
  });

  it("reassigns the member's owned connections to the acting admin then deletes", async () => {
    const ctx = await seed();
    const conn = ctx.store.saveConnection({
      tech: "postgres",
      name: "bob-db",
      config: { host: "localhost" } as unknown as Record<string, unknown>,
      status: "untested",
      ownerId: ctx.member.id,
    });
    const res = await ctx.byId.DELETE(
      get(`http://localhost/api/users/${ctx.member.id}`, ctx.adminToken),
      { params: Promise.resolve({ id: ctx.member.id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // user gone
    expect(ctx.users.getUserById(ctx.member.id)).toBeNull();
    // connection reassigned to the acting admin
    const reassigned = ctx.store.getConnection(conn.id);
    expect(reassigned?.ownerId).toBe(ctx.admin.id);
    // target's session revoked
    expect(ctx.session.verifySessionToken(ctx.memberToken)).toBe(false);
  });
});

describe("GET /api/users/me", () => {
  it("returns 401 without a session", async () => {
    const ctx = await seed();
    const res = await ctx.me.GET(get("http://localhost/api/users/me"));
    expect(res.status).toBe(401);
  });

  it("returns the current user for any authenticated role", async () => {
    const ctx = await seed();
    const res = await ctx.me.GET(get("http://localhost/api/users/me", ctx.memberToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.id).toBe(ctx.member.id);
    expect(body.user.username).toBe("bob");
    expect(body.user.passwordHash).toBeUndefined();
  });
});
