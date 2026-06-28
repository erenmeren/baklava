import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SESSION_COOKIE } from "@/lib/auth/session";

// The legacy single-password store (store.ts) binds its DATA_DIR at module-load
// time, so in a shared test worker it can stay pinned to another file's dir
// whose in-memory state still carries a real password hash. That would make the
// users store run its one-time legacy migration (minting an 'admin') into our
// fresh per-test users.json and defeat needsSetup(). The legacy→users migration
// is exercised by users.test.ts; here we test the routes against a clean users
// store, so stub the migration source to always report "nothing to migrate".
vi.mock("@/lib/auth/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/store")>();
  return { ...actual, getLegacyPasswordForMigration: () => null };
});

// Each test gets its own throwaway DATA_DIR. We reset the users, sessions, and
// legacy-auth caches so nothing leaks between tests, and drive the routes via
// constructed Requests exactly as Next would.
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
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-auth-routes-"));
  process.env.BAKLAVA_DATA_DIR = TMP;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
  resetCaches();
});

afterEach(() => {
  resetCaches();
  delete process.env.BAKLAVA_DATA_DIR;
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

function jsonReq(url: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

// Pull the session token out of a Set-Cookie header on the response.
function cookieToken(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const m = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie);
  return m ? m[1] : null;
}

// Assert no password/hash material is present anywhere in a response body.
function assertNoSecrets(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/passwordHash/i);
  expect(text.toLowerCase()).not.toContain("salt");
  // no raw scrypt hex blob (64 bytes → 128 hex chars)
  expect(text).not.toMatch(/[0-9a-f]{128}/i);
}

async function runSetup(username: string, newPassword: string, cookie?: string) {
  const { POST } = await import("@/app/api/auth/setup/route");
  return POST(
    jsonReq("http://x/api/auth/setup", { username, newPassword }, cookie) as never,
  );
}

async function runLogin(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/auth/login/route");
  return POST(jsonReq("http://x/api/auth/login", body, cookie) as never);
}

async function runChangePassword(body: unknown, cookie?: string) {
  const { POST } = await import("@/app/api/auth/change-password/route");
  return POST(jsonReq("http://x/api/auth/change-password", body, cookie) as never);
}

describe("auth routes (multi-user)", () => {
  it("setup creates the first admin and sets a session cookie", async () => {
    const res = await runSetup("admin", "hunter2");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(cookieToken(res)).toBeTruthy();
    assertNoSecrets(body);

    const { getUserByUsername } = await import("@/lib/auth/users");
    const u = getUserByUsername("admin");
    expect(u?.role).toBe("admin");
  });

  it("setup 409s once a user exists", async () => {
    await runSetup("admin", "hunter2");
    const res = await runSetup("second", "pw");
    expect(res.status).toBe(409);
  });

  it("setup 400s on an invalid username", async () => {
    const res = await runSetup("bad name!", "pw");
    expect(res.status).toBe(400);
  });

  it("login by username succeeds and sets a cookie", async () => {
    await runSetup("admin", "hunter2");
    const res = await runLogin({ username: "admin", password: "hunter2" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    expect(cookieToken(res)).toBeTruthy();
    assertNoSecrets(body);
  });

  it("login with password only works when exactly one user exists", async () => {
    await runSetup("admin", "hunter2");
    const res = await runLogin({ password: "hunter2" });
    expect(res.status).toBe(200);
    expect(cookieToken(res)).toBeTruthy();
  });

  it("login password-only fails when multiple users exist", async () => {
    await runSetup("admin", "hunter2");
    const { createUser } = await import("@/lib/auth/users");
    createUser({ username: "bob", password: "bobpw", role: "member" });
    const res = await runLogin({ password: "hunter2" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid credentials" });
  });

  it("unknown username and wrong password return identical 401 bodies", async () => {
    await runSetup("admin", "hunter2");

    const unknown = await runLogin({ username: "nobody", password: "whatever" });
    const wrong = await runLogin({ username: "admin", password: "wrong" });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    const a = await unknown.json();
    const b = await wrong.json();
    expect(a).toEqual({ error: "Invalid credentials" });
    expect(b).toEqual(a);
    expect(cookieToken(unknown)).toBeNull();
    expect(cookieToken(wrong)).toBeNull();
    assertNoSecrets(a);
  });

  it("a disabled user cannot log in", async () => {
    await runSetup("admin", "hunter2");
    const { createUser, updateUser } = await import("@/lib/auth/users");
    const bob = createUser({ username: "bob", password: "bobpw", role: "member" });
    updateUser(bob.id, { disabled: true });
    const res = await runLogin({ username: "bob", password: "bobpw" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid credentials" });
  });

  it("change-password verifies current, rotates, and keeps this device logged in", async () => {
    const setup = await runSetup("admin", "hunter2");
    const token = cookieToken(setup)!;
    const cookie = `${SESSION_COOKIE}=${token}`;

    // wrong current password → 401
    const wrong = await runChangePassword(
      { currentPassword: "nope", newPassword: "new1" },
      cookie,
    );
    expect(wrong.status).toBe(401);

    const res = await runChangePassword(
      { currentPassword: "hunter2", newPassword: "new1" },
      cookie,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    assertNoSecrets(body);

    // a fresh cookie is issued (this device stays logged in)
    const newToken = cookieToken(res)!;
    expect(newToken).toBeTruthy();

    // old password no longer works; new one does
    const oldPw = await runLogin({ username: "admin", password: "hunter2" });
    expect(oldPw.status).toBe(401);
    const newPw = await runLogin({ username: "admin", password: "new1" });
    expect(newPw.status).toBe(200);
  });

  it("change-password 401s with no session", async () => {
    await runSetup("admin", "hunter2");
    const res = await runChangePassword({ currentPassword: "hunter2", newPassword: "x" });
    expect(res.status).toBe(401);
  });
});
