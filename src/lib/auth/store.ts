import os from "node:os";
import path from "node:path";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { readSecretFileSync, writeSecretFileSync } from "@/lib/crypto/secret-file";

// ─────────────────────────────────────────────────────────────────────────────
// Single-password auth state.
//
// Baklava ships with NO auth, which is fine on localhost but dangerous when the
// server is exposed to a network — anyone can read stored connections (incl. DB
// passwords) and run destructive queries. This module backs a single shared
// password gate (no usernames): one scrypt-hashed password + a random session
// signing secret, persisted alongside connections.json under ~/.baklava.
//
// Bootstrap: there is NO default password. On first run the console is
// "unconfigured" (passwordHash is empty) and the first visit prompts the user to
// create one. Setting BAKLAVA_INITIAL_PASSWORD configures it up front instead.
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR =
  process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
const FILE = path.join(DATA_DIR, "auth.json");
const SCRYPT_KEYLEN = 64;

export interface AuthState {
  version: 1;
  salt: string; // hex
  passwordHash: string; // hex (scrypt of password+salt), or "" when unconfigured
  secret: string; // hex — HMAC key for session tokens
  /** Legacy flag from the old bootstrap-default flow. New files set it false; an
   *  old file with it true is treated as unconfigured (see needsSetup). */
  mustChange: boolean;
  /** When false, the password gate is disabled and every request is allowed.
   *  Absent in older auth.json files → treated as enabled. */
  enabled?: boolean;
  updatedAt: number;
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(
    password,
    Buffer.from(saltHex, "hex"),
    SCRYPT_KEYLEN,
  ).toString("hex");
}

/** Build an ENOENT-coded error so the load() catch routes a missing file to the
 *  fresh-state seed path (matching the previous fs.readFileSync ENOENT behavior). */
function makeEnoent(): NodeJS.ErrnoException {
  const e = new Error("auth.json not found") as NodeJS.ErrnoException;
  e.code = "ENOENT";
  return e;
}

function freshState(): AuthState {
  const salt = randomBytes(16).toString("hex");
  const seed = process.env.BAKLAVA_INITIAL_PASSWORD;
  return {
    version: 1,
    salt,
    // No public default: without a deployer-provided password the console is
    // unconfigured and the first visit prompts the user to create one.
    passwordHash: seed ? hashPassword(seed, salt) : "",
    secret: randomBytes(32).toString("hex"),
    mustChange: false,
    enabled: true,
    updatedAt: Date.now(),
  };
}

// Cache on globalThis so it survives Next dev HMR and is shared between the
// proxy, layout, and route handlers in the same process.
const CACHE_KEY = Symbol.for("baklava.authState");

function persist(state: AuthState): void {
  // writeSecretFileSync encrypts to an envelope, writes 0o600 atomically
  // (temp + rename), creates the data dir, and backs up any legacy plaintext /
  // unreadable file before overwriting.
  writeSecretFileSync(FILE, JSON.stringify(state, null, 2));
  (globalThis as Record<symbol, AuthState | undefined>)[CACHE_KEY] = state;
}

function load(): AuthState {
  const g = globalThis as Record<symbol, AuthState | undefined>;
  const cached = g[CACHE_KEY];
  if (cached) return cached;

  let state: AuthState;
  try {
    // readSecretFileSync decrypts an envelope, transparently passes through a
    // legacy plaintext file, and returns null when the file is absent (ENOENT).
    const text = readSecretFileSync(FILE);
    if (text === null) throw makeEnoent();
    const parsed = JSON.parse(text) as AuthState;
    if (
      !parsed ||
      typeof parsed.passwordHash !== "string" ||
      typeof parsed.salt !== "string" ||
      typeof parsed.secret !== "string"
    ) {
      throw new Error("malformed auth.json");
    }
    state = parsed;
    g[CACHE_KEY] = state;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code && code !== "ENOENT") {
      console.warn(`[baklava] could not read ${FILE}, re-seeding:`, err);
    }
    state = freshState();
    persist(state); // also caches
  }
  return state;
}

/** HMAC key used to sign/verify session tokens. */
export function getAuthSecret(): string {
  return load().secret;
}

/** True when no password has been configured yet — the first run (or a legacy
 *  bootstrap-default file). The first visit must create one before anything is
 *  reachable. */
export function needsSetup(): boolean {
  const s = load();
  return s.passwordHash === "" || s.mustChange === true;
}

/** Whether the password gate is active. Defaults to true for older files. */
export function isAuthEnabled(): boolean {
  return load().enabled !== false;
}

/** Turn the password gate on or off. */
export function setAuthEnabled(enabled: boolean): void {
  const s = load();
  persist({ ...s, enabled, updatedAt: Date.now() });
}

/** Constant-time check of a candidate password against the stored hash.
 *  Always false while unconfigured (there is nothing to match against). */
export function verifyPassword(password: string): boolean {
  const s = load();
  if (s.passwordHash === "" || s.mustChange === true) return false;
  const candidate = Buffer.from(hashPassword(password, s.salt), "hex");
  const stored = Buffer.from(s.passwordHash, "hex");
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

/** Read the current legacy single-password hash+salt for the one-time RBAC
 *  migration. Returns null when unconfigured (empty hash) or pending a forced
 *  change. Pure read — does not alter stored state. */
export function getLegacyPasswordForMigration(): { passwordHash: string; salt: string } | null {
  const s = load();
  if (s.passwordHash === "" || s.mustChange === true) return null;
  return { passwordHash: s.passwordHash, salt: s.salt };
}

/** Set the password (first-time setup or a later rotation), marking the console
 *  configured. Secret is preserved so the caller's freshly issued session stays
 *  valid. */
export function setPassword(newPassword: string): void {
  const s = load();
  const salt = randomBytes(16).toString("hex");
  persist({
    ...s,
    salt,
    passwordHash: hashPassword(newPassword, salt),
    mustChange: false,
    updatedAt: Date.now(),
  });
}
