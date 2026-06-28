import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Each test gets its own throwaway DATA_DIR. DATA_DIR is resolved lazily in
// users.ts (via getDataDir()), but the legacy auth store reads it at module
// load, so we re-import dynamically after setting the env where needed.
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

beforeEach(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-users-test-"));
  process.env.BAKLAVA_DATA_DIR = TMP;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
  resetCaches();
  await resetLegacyAuth();
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

// The legacy auth store binds its DATA_DIR at first import (a module-level
// const), so every test in this file shares ONE legacy auth.json regardless of
// per-test TMP dirs. We must therefore reset the legacy password between tests
// by clearing the legacy store cache AND its persisted state.
// Captured on first store import so we can clean the shared legacy auth.json.
let LEGACY_DATA_DIR: string | undefined;

async function resetLegacyAuth(): Promise<void> {
  // The store binds DATA_DIR at first import → capture that env value now.
  if (LEGACY_DATA_DIR === undefined) LEGACY_DATA_DIR = process.env.BAKLAVA_DATA_DIR;
  await import("./store"); // ensure module-load dir is bound to LEGACY_DATA_DIR
  // The store re-seeds a fresh (empty-hash) unconfigured state when auth.json
  // is missing, so deleting the file + clearing the cache is enough to undo any
  // setPassword() a prior test performed.
  delete (globalThis as Record<symbol, unknown>)[AUTH_CACHE];
  try {
    fs.rmSync(path.join(LEGACY_DATA_DIR as string, "auth.json"), { force: true });
  } catch {
    /* ignore */
  }
}

async function load(): Promise<Users> {
  if (LEGACY_DATA_DIR === undefined) LEGACY_DATA_DIR = process.env.BAKLAVA_DATA_DIR;
  const mod = await import("./users");
  mod._resetUsersCacheForTests();
  return mod;
}

describe("users store — basics", () => {
  it("needsSetup() is true on an empty store", async () => {
    const users = await load();
    expect(users.needsSetup()).toBe(true);
    expect(users.listUsers()).toEqual([]);
  });

  it("creates and fetches by id and by username (case-insensitive)", async () => {
    const users = await load();
    const u = users.createUser({ username: "Alice", password: "pw", role: "admin" });
    expect(u.username).toBe("alice"); // lowercased
    expect(u.role).toBe("admin");
    expect(u.disabled).toBe(false);
    expect(users.getUserById(u.id)?.id).toBe(u.id);
    expect(users.getUserByUsername("ALICE")?.id).toBe(u.id);
    expect(users.getUserByUsername("alice")?.id).toBe(u.id);
    expect(users.getUserByUsername("bob")).toBeNull();
    expect(users.needsSetup()).toBe(false);
  });

  it("writes users.json with 0600 perms", async () => {
    const users = await load();
    users.createUser({ username: "alice", password: "pw", role: "admin" });
    const mode = fs.statSync(path.join(TMP, "users.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("publicUser omits hash and salt", async () => {
    const users = await load();
    const u = users.createUser({ username: "alice", password: "pw", role: "admin" });
    const pub = users.publicUser(u);
    expect(pub).not.toHaveProperty("passwordHash");
    expect(pub).not.toHaveProperty("salt");
    expect(pub.username).toBe("alice");
  });
});

describe("users store — validation", () => {
  it("throws on a duplicate username (case-insensitive)", async () => {
    const users = await load();
    users.createUser({ username: "alice", password: "pw", role: "admin" });
    expect(() =>
      users.createUser({ username: "ALICE", password: "pw2", role: "member" }),
    ).toThrow();
  });

  it("throws on an invalid username", async () => {
    const users = await load();
    expect(() =>
      users.createUser({ username: "has space", password: "pw", role: "admin" }),
    ).toThrow();
    expect(() =>
      users.createUser({ username: "", password: "pw", role: "admin" }),
    ).toThrow();
    expect(() =>
      users.createUser({ username: "a".repeat(65), password: "pw", role: "admin" }),
    ).toThrow();
  });
});

describe("users store — password verification", () => {
  it("verifies correct and rejects wrong passwords", async () => {
    const users = await load();
    const u = users.createUser({ username: "alice", password: "secret", role: "admin" });
    expect(users.verifyUserPassword(u, "secret")).toBe(true);
    expect(users.verifyUserPassword(u, "nope")).toBe(false);
    expect(users.verifyUserPassword(u, "")).toBe(false);
  });
});

describe("users store — last-admin guards", () => {
  it("blocks demoting the last enabled admin", async () => {
    const users = await load();
    const admin = users.createUser({ username: "admin", password: "pw", role: "admin" });
    expect(() => users.updateUser(admin.id, { role: "member" })).toThrow();
    expect(users.countAdmins()).toBe(1);
  });

  it("blocks disabling the last enabled admin", async () => {
    const users = await load();
    const admin = users.createUser({ username: "admin", password: "pw", role: "admin" });
    expect(() => users.updateUser(admin.id, { disabled: true })).toThrow();
  });

  it("blocks deleting the last enabled admin", async () => {
    const users = await load();
    const admin = users.createUser({ username: "admin", password: "pw", role: "admin" });
    expect(() => users.deleteUser(admin.id)).toThrow();
  });

  it("allows demoting an admin when another enabled admin remains", async () => {
    const users = await load();
    const a = users.createUser({ username: "a", password: "pw", role: "admin" });
    users.createUser({ username: "b", password: "pw", role: "admin" });
    expect(users.countAdmins()).toBe(2);
    const updated = users.updateUser(a.id, { role: "member" });
    expect(updated.role).toBe("member");
    expect(users.countAdmins()).toBe(1);
  });

  it("updateUser can rotate a password", async () => {
    const users = await load();
    const a = users.createUser({ username: "a", password: "pw", role: "admin" });
    users.createUser({ username: "b", password: "pw", role: "admin" });
    const updated = users.updateUser(a.id, { password: "newpw" });
    expect(users.verifyUserPassword(updated, "newpw")).toBe(true);
    expect(users.verifyUserPassword(updated, "pw")).toBe(false);
  });
});

describe("users store — migration from legacy single password", () => {
  it("creates an 'admin' user from a seeded legacy auth.json and revokes sessions", async () => {
    // Seed a legacy password via the legacy store (writes auth.json).
    const legacy = await import("./store");
    legacy.setPassword("legacy-secret");

    // Seed a session that the migration must revoke.
    const sessions = await import("./sessions");
    const sess = sessions.createSession("test-agent");
    expect(sessions.verifySession(sess.id)).toBe(true);

    // First load of the users store triggers migration.
    const users = await load();
    const list = users.listUsers();
    expect(list).toHaveLength(1);
    const admin = list[0];
    expect(admin.username).toBe("admin");
    expect(admin.role).toBe("admin");
    expect(admin.disabled).toBe(false);
    // Reuses the legacy hash → legacy password still verifies.
    expect(users.verifyUserPassword(admin, "legacy-secret")).toBe(true);
    // users.json now exists.
    expect(fs.existsSync(path.join(TMP, "users.json"))).toBe(true);
    // Sessions were revoked (revokeAllExcept(null)).
    expect(sessions.verifySession(sess.id)).toBe(false);
    expect(users.needsSetup()).toBe(false);
  });

  it("does not migrate when there is no legacy password (stays empty)", async () => {
    const users = await load();
    expect(users.listUsers()).toEqual([]);
    expect(users.needsSetup()).toBe(true);
  });

  it("is idempotent — does not re-migrate when users.json already exists", async () => {
    const legacy = await import("./store");
    legacy.setPassword("legacy-secret");

    const users = await load();
    expect(users.listUsers()).toHaveLength(1);
    // Add another user, then reset the in-memory cache and reload.
    users.createUser({ username: "bob", password: "pw", role: "member" });
    users._resetUsersCacheForTests();
    expect(users.listUsers()).toHaveLength(2); // migration did not run again
  });
});
