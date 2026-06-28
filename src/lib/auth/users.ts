import os from "node:os";
import path from "node:path";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { readSecretFileSync, writeSecretFileSync } from "../crypto/secret-file";
import { getLegacyPasswordForMigration } from "./store";
import { revokeAllExcept } from "./sessions";

// ─────────────────────────────────────────────────────────────────────────────
// Multi-user RBAC store.
//
// Replaces the single shared password (src/lib/auth/store.ts) with a per-user
// records file. On first load, if an existing single-password install is found
// (a non-empty legacy auth.json hash) and no users.json exists yet, we migrate
// it into a single `admin` user that reuses the same scrypt hash+salt — so the
// deployer's existing password keeps working — then revoke all live sessions so
// every device re-authenticates against the new model.
//
// Passwords/hashes never leave the server. users.json is encrypted at rest via
// the secret-file envelope helpers and written 0600.
// ─────────────────────────────────────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;
const USERNAME_RE = /^[a-z0-9._-]{1,64}$/;

export type Role = "admin" | "member";

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string; // hex (scrypt of password+salt)
  salt: string; // hex
  role: Role;
  disabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: number;
}

interface UsersFile {
  version: 1;
  users: UserRecord[];
}

function getDataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function getFile(): string {
  return path.join(getDataDir(), "users.json");
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN).toString("hex");
}

// Cache on globalThis so it survives Next dev HMR and is shared across the
// proxy, layout, and route handlers in the same process.
const CACHE_KEY = Symbol.for("baklava.usersStore");

interface Store {
  byId: Map<string, UserRecord>;
}

function emptyStore(): Store {
  return { byId: new Map() };
}

function readFile(): UsersFile | null {
  const text = readSecretFileSync(getFile());
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as UsersFile;
    if (!parsed || !Array.isArray(parsed.users)) return { version: 1, users: [] };
    return parsed;
  } catch {
    return { version: 1, users: [] };
  }
}

function persist(store: Store): void {
  const file: UsersFile = { version: 1, users: [...store.byId.values()] };
  writeSecretFileSync(getFile(), JSON.stringify(file, null, 2));
}

/** One-time migration from the legacy single-password model. Only runs when
 *  users.json is absent. Reuses the legacy hash+salt so the existing password
 *  keeps working, then revokes all sessions so every device re-authenticates. */
function migrateFromLegacy(store: Store): void {
  const legacy = getLegacyPasswordForMigration();
  if (!legacy) return; // unconfigured legacy install → nothing to migrate
  const now = Date.now();
  const rec: UserRecord = {
    id: randomBytes(12).toString("base64url"),
    username: "admin",
    passwordHash: legacy.passwordHash,
    salt: legacy.salt,
    role: "admin",
    disabled: false,
    createdAt: now,
    updatedAt: now,
  };
  store.byId.set(rec.id, rec);
  persist(store);
  revokeAllExcept(null);
  console.warn(
    "[baklava] migrated to multi-user: admin user 'admin' created from existing password",
  );
}

function load(): Store {
  const g = globalThis as Record<symbol, Store | undefined>;
  const cached = g[CACHE_KEY];
  if (cached) return cached;

  const store = emptyStore();
  const file = readFile();
  if (file === null) {
    // users.json absent → first load. Attempt one-time legacy migration.
    migrateFromLegacy(store);
  } else {
    for (const u of file.users) if (u?.id) store.byId.set(u.id, u);
  }
  g[CACHE_KEY] = store;
  return store;
}

export function publicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: u.disabled,
    createdAt: u.createdAt,
  };
}

export function listUsers(): UserRecord[] {
  return [...load().byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function getUserById(id: string): UserRecord | null {
  return load().byId.get(id) ?? null;
}

export function getUserByUsername(name: string): UserRecord | null {
  const target = name.toLowerCase();
  for (const u of load().byId.values()) {
    if (u.username === target) return u;
  }
  return null;
}

/** Constant-time check of a candidate password against a user's stored hash. */
export function verifyUserPassword(user: UserRecord, password: string): boolean {
  if (!user.passwordHash) return false;
  const candidate = Buffer.from(hashPassword(password, user.salt), "hex");
  const stored = Buffer.from(user.passwordHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/** Count of enabled admins — the invariant we never let drop below 1. */
export function countAdmins(): number {
  let n = 0;
  for (const u of load().byId.values()) {
    if (u.role === "admin" && !u.disabled) n++;
  }
  return n;
}

/** True when no users exist — the first run needs an initial admin. */
export function needsSetup(): boolean {
  return load().byId.size === 0;
}

export function createUser(input: { username: string; password: string; role: Role }): UserRecord {
  const store = load();
  const username = input.username.toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new Error(
      `Invalid username "${input.username}" — use 1-64 chars of a-z, 0-9, dot, dash, or underscore.`,
    );
  }
  for (const u of store.byId.values()) {
    if (u.username === username) throw new Error(`Username "${username}" already exists.`);
  }
  const now = Date.now();
  const salt = randomBytes(16).toString("hex");
  const rec: UserRecord = {
    id: randomBytes(12).toString("base64url"),
    username,
    passwordHash: hashPassword(input.password, salt),
    salt,
    role: input.role,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  };
  store.byId.set(rec.id, rec);
  persist(store);
  return rec;
}

export function updateUser(
  id: string,
  patch: { role?: Role; disabled?: boolean; password?: string },
): UserRecord {
  const store = load();
  const existing = store.byId.get(id);
  if (!existing) throw new Error("User not found.");

  // Would this change strip the last enabled admin? Compute the next state of
  // *this* record's admin-ness and compare against the rest.
  const wasEnabledAdmin = existing.role === "admin" && !existing.disabled;
  const nextRole = patch.role ?? existing.role;
  const nextDisabled = patch.disabled ?? existing.disabled;
  const willBeEnabledAdmin = nextRole === "admin" && !nextDisabled;
  if (wasEnabledAdmin && !willBeEnabledAdmin && countAdmins() <= 1) {
    throw new Error("Cannot leave the console without an enabled admin.");
  }

  const next: UserRecord = {
    ...existing,
    role: nextRole,
    disabled: nextDisabled,
    updatedAt: Date.now(),
  };
  if (patch.password !== undefined) {
    const salt = randomBytes(16).toString("hex");
    next.salt = salt;
    next.passwordHash = hashPassword(patch.password, salt);
  }
  store.byId.set(id, next);
  persist(store);
  return next;
}

export function deleteUser(id: string): void {
  const store = load();
  const existing = store.byId.get(id);
  if (!existing) return;
  if (existing.role === "admin" && !existing.disabled && countAdmins() <= 1) {
    throw new Error("Cannot delete the last enabled admin.");
  }
  store.byId.delete(id);
  persist(store);
}

export function _resetUsersCacheForTests(): void {
  delete (globalThis as Record<symbol, unknown>)[CACHE_KEY];
}
