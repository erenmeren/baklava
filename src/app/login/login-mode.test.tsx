import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ReactElement } from "react";

// Regression for the post-RBAC setup/login split: the first-run UI setup
// creates a record in users.json but never fills the LEGACY auth.json password
// hash. The login page must therefore decide setup-vs-login from the users
// store (like the proxy does) — deciding from the legacy store re-shows the
// "Create a password" form forever, whose submit 409s ("Setup has already
// been completed"), locking the user out of the sign-in form.

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
// The legacy store binds DATA_DIR at first import — capture it so its shared
// auth.json can be wiped back to the unconfigured (empty-hash) state.
let LEGACY_DATA_DIR: string | undefined;

beforeEach(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-login-mode-test-"));
  process.env.BAKLAVA_DATA_DIR = TMP;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
  resetCaches();
  if (LEGACY_DATA_DIR === undefined) LEGACY_DATA_DIR = process.env.BAKLAVA_DATA_DIR;
  await import("@/lib/auth/store");
  delete (globalThis as Record<symbol, unknown>)[AUTH_CACHE];
  fs.rmSync(path.join(LEGACY_DATA_DIR as string, "auth.json"), { force: true });
});

afterEach(() => {
  resetCaches();
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

async function renderedMode(): Promise<{ mode: string; multiUser: boolean }> {
  const { default: LoginPage } = await import("./page");
  const page = (await LoginPage()) as ReactElement<{
    children: ReactElement<{ mode: string; multiUser: boolean }>;
  }>;
  const client = page.props.children;
  return { mode: client.props.mode, multiUser: client.props.multiUser };
}

describe("login page mode", () => {
  it("shows the setup form while the console has no users", async () => {
    const users = await import("@/lib/auth/users");
    users._resetUsersCacheForTests();
    expect((await renderedMode()).mode).toBe("setup");
  });

  it("shows the sign-in form after first-run UI setup, even though the legacy auth.json hash is empty", async () => {
    const users = await import("@/lib/auth/users");
    users._resetUsersCacheForTests();
    // What POST /api/auth/setup does — creates the admin user only; the
    // legacy single-password store is intentionally left untouched.
    users.createUser({ username: "meren", password: "pw-123", role: "admin" });

    const store = await import("@/lib/auth/store");
    expect(store.needsSetup()).toBe(true); // legacy hash still empty
    expect(users.needsSetup()).toBe(false); // but a user exists

    const { mode, multiUser } = await renderedMode();
    expect(mode).toBe("login"); // the bug rendered "setup" here
    expect(multiUser).toBe(false); // single user → password-only form
  });

  it("asks for a username once a second user exists", async () => {
    const users = await import("@/lib/auth/users");
    users._resetUsersCacheForTests();
    users.createUser({ username: "meren", password: "pw-123", role: "admin" });
    users.createUser({ username: "guest", password: "pw-456", role: "member" });
    const { mode, multiUser } = await renderedMode();
    expect(mode).toBe("login");
    expect(multiUser).toBe(true);
  });
});
