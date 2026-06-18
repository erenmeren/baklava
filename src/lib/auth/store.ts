import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Single-password auth state.
//
// Baklava ships with NO auth, which is fine on localhost but dangerous when the
// server is exposed to a network — anyone can read stored connections (incl. DB
// passwords) and run destructive queries. This module backs a single shared
// password gate (no usernames): one scrypt-hashed password + a random session
// signing secret, persisted alongside connections.json under ~/.baklava.
//
// Bootstrap: on first run the password is seeded to `password123` (override with
// BAKLAVA_INITIAL_PASSWORD) and `mustChange` is set, so the very first sign-in
// forces a new password. When BAKLAVA_INITIAL_PASSWORD is set we trust it and
// skip the forced change.
// ─────────────────────────────────────────────────────────────────────────────

const DATA_DIR =
  process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
const FILE = path.join(DATA_DIR, "auth.json");
const DEFAULT_PASSWORD = "password123";
const SCRYPT_KEYLEN = 64;

export interface AuthState {
  version: 1;
  salt: string; // hex
  passwordHash: string; // hex (scrypt of password+salt)
  secret: string; // hex — HMAC key for session tokens
  mustChange: boolean;
  updatedAt: number;
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(
    password,
    Buffer.from(saltHex, "hex"),
    SCRYPT_KEYLEN,
  ).toString("hex");
}

function freshState(): AuthState {
  const salt = randomBytes(16).toString("hex");
  const seed = process.env.BAKLAVA_INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return {
    version: 1,
    salt,
    passwordHash: hashPassword(seed, salt),
    secret: randomBytes(32).toString("hex"),
    // A deployer-chosen password is trusted; the public default must be changed.
    mustChange: !process.env.BAKLAVA_INITIAL_PASSWORD,
    updatedAt: Date.now(),
  };
}

// Cache on globalThis so it survives Next dev HMR and is shared between the
// proxy, layout, and route handlers in the same process.
const CACHE_KEY = Symbol.for("baklava.authState");

function persist(state: AuthState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  (globalThis as Record<symbol, AuthState | undefined>)[CACHE_KEY] = state;
}

function load(): AuthState {
  const g = globalThis as Record<symbol, AuthState | undefined>;
  const cached = g[CACHE_KEY];
  if (cached) return cached;

  let state: AuthState;
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as AuthState;
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

/** True while the bootstrap default password is still in place. */
export function mustChangePassword(): boolean {
  return load().mustChange;
}

/** Constant-time check of a candidate password against the stored hash. */
export function verifyPassword(password: string): boolean {
  const s = load();
  const candidate = Buffer.from(hashPassword(password, s.salt), "hex");
  const stored = Buffer.from(s.passwordHash, "hex");
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

/** Set a new password, clearing the forced-change flag. Secret is preserved so
 *  the caller's freshly issued session stays valid. */
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

/** The bootstrap default, exported so routes can reject keeping it. */
export const DEFAULT_BOOTSTRAP_PASSWORD = DEFAULT_PASSWORD;
