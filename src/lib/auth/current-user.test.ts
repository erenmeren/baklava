import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Each test gets its own throwaway DATA_DIR. Both the users store and the
// session store cache on globalThis, so reset both between tests.
const AUTH_CACHE = Symbol.for("baklava.authState");
const USERS_CACHE = Symbol.for("baklava.usersStore");
const SESSION_CACHE = Symbol.for("baklava.sessionStore");

function resetCaches() {
  const g = globalThis as Record<symbol, unknown>;
  delete g[AUTH_CACHE];
  delete g[USERS_CACHE];
  delete g[SESSION_CACHE];
}

let TMP: string;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-current-user-test-"));
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

type CurrentUser = typeof import("./current-user");
type Users = typeof import("./users");
type Session = typeof import("./session");

async function load(): Promise<{ cu: CurrentUser; users: Users; session: Session }> {
  const users = await import("./users");
  users._resetUsersCacheForTests();
  const sessions = await import("./sessions");
  sessions._resetSessionCacheForTests();
  const session = await import("./session");
  const cu = await import("./current-user");
  return { cu, users, session };
}

/** Build a Request carrying the session cookie. */
function reqWithCookie(token: string): { headers: Headers } {
  return new Request("http://localhost/x", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
  });
}

const SESSION_COOKIE_NAME = "baklava_session";

describe("getCurrentUser", () => {
  it("returns the user for a valid session cookie", async () => {
    const { cu, users, session } = await load();
    const u = users.createUser({ username: "alice", password: "pw", role: "admin" });
    const token = session.createSessionToken(u.id);
    const got = cu.getCurrentUser(reqWithCookie(token));
    expect(got?.id).toBe(u.id);
    expect(got?.username).toBe("alice");
  });

  it("returns null when the cookie is absent", async () => {
    const { cu } = await load();
    const req = new Request("http://localhost/x");
    expect(cu.getCurrentUser(req)).toBeNull();
  });

  it("returns null for a garbage cookie value", async () => {
    const { cu } = await load();
    expect(cu.getCurrentUser(reqWithCookie("not-a-real-token"))).toBeNull();
  });

  it("returns null for a disabled user", async () => {
    const { cu, users, session } = await load();
    const admin = users.createUser({ username: "admin", password: "pw", role: "admin" });
    const member = users.createUser({ username: "bob", password: "pw", role: "member" });
    const token = session.createSessionToken(member.id);
    users.updateUser(member.id, { disabled: true });
    expect(admin.id).toBeTruthy(); // keep the last-admin guard happy
    expect(cu.getCurrentUser(reqWithCookie(token))).toBeNull();
  });

  it("returns null when the bound user no longer exists", async () => {
    const { cu, users, session } = await load();
    const a = users.createUser({ username: "admin", password: "pw", role: "admin" });
    const b = users.createUser({ username: "bob", password: "pw", role: "admin" });
    const token = session.createSessionToken(b.id);
    users.deleteUser(b.id);
    expect(a.id).toBeTruthy();
    expect(cu.getCurrentUser(reqWithCookie(token))).toBeNull();
  });
});

describe("requireUser", () => {
  it("returns the user when authenticated", async () => {
    const { cu, users, session } = await load();
    const u = users.createUser({ username: "alice", password: "pw", role: "member" });
    const token = session.createSessionToken(u.id);
    expect(cu.requireUser(reqWithCookie(token)).id).toBe(u.id);
  });

  it("throws AuthError(401) when not authenticated", async () => {
    const { cu } = await load();
    const req = new Request("http://localhost/x");
    try {
      cu.requireUser(req);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(cu.AuthError);
      expect((err as InstanceType<CurrentUser["AuthError"]>).status).toBe(401);
    }
  });
});

describe("requireAdmin", () => {
  it("returns the user for an admin", async () => {
    const { cu, users, session } = await load();
    const u = users.createUser({ username: "admin", password: "pw", role: "admin" });
    const token = session.createSessionToken(u.id);
    expect(cu.requireAdmin(reqWithCookie(token)).id).toBe(u.id);
  });

  it("throws AuthError(403) for a member", async () => {
    const { cu, users, session } = await load();
    users.createUser({ username: "admin", password: "pw", role: "admin" });
    const member = users.createUser({ username: "bob", password: "pw", role: "member" });
    const token = session.createSessionToken(member.id);
    try {
      cu.requireAdmin(reqWithCookie(token));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(cu.AuthError);
      expect((err as InstanceType<CurrentUser["AuthError"]>).status).toBe(403);
    }
  });

  it("throws AuthError(401) when not authenticated", async () => {
    const { cu } = await load();
    try {
      cu.requireAdmin(new Request("http://localhost/x"));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(cu.AuthError);
      expect((err as InstanceType<CurrentUser["AuthError"]>).status).toBe(401);
    }
  });
});

describe("gate off (isAuthEnabled() === false) acts as a synthetic admin", () => {
  it("getCurrentUser returns the synthetic admin even with no cookie", async () => {
    const { cu } = await load();
    const store = await import("./store");
    store.setAuthEnabled(false);
    try {
      const got = cu.getCurrentUser(new Request("http://localhost/x"));
      expect(got).not.toBeNull();
      expect(got?.id).toBe("__local_admin__");
      expect(got?.role).toBe("admin");
      expect(got?.disabled).toBe(false);
    } finally {
      store.setAuthEnabled(true); // restore the gate
    }
  });

  it("requireUser and requireAdmin do not throw when the gate is off", async () => {
    const { cu } = await load();
    const store = await import("./store");
    store.setAuthEnabled(false);
    try {
      const req = new Request("http://localhost/x");
      expect(() => cu.requireUser(req)).not.toThrow();
      expect(() => cu.requireAdmin(req)).not.toThrow();
      expect(cu.requireAdmin(req).id).toBe("__local_admin__");
    } finally {
      store.setAuthEnabled(true);
    }
  });
});

describe("authErrorResponse", () => {
  it("maps an AuthError to a JSON Response with its status", async () => {
    const { cu } = await load();
    const res = cu.authErrorResponse(new cu.AuthError(403, "Admin required"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = await res!.json();
    expect(body.error).toBe("Admin required");
  });

  it("returns null for a non-AuthError", async () => {
    const { cu } = await load();
    expect(cu.authErrorResponse(new Error("boom"))).toBeNull();
    expect(cu.authErrorResponse("nope")).toBeNull();
  });
});
