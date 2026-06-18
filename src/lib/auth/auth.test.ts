import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createHmac } from "node:crypto";

// Point the auth store at a throwaway dir BEFORE importing it (DATA_DIR is read
// at module load). Seeded with the bootstrap default (no BAKLAVA_INITIAL_PASSWORD).
const TMP = path.join(
  os.tmpdir(),
  `baklava-auth-test-${process.pid}-${Date.now()}`,
);
process.env.BAKLAVA_DATA_DIR = TMP;
delete process.env.BAKLAVA_INITIAL_PASSWORD;
// Clear any cached state from a sibling test in the same worker.
delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.authState")];

type Store = typeof import("./store");
type Session = typeof import("./session");
let store: Store;
let session: Session;

beforeAll(async () => {
  store = await import("./store");
  session = await import("./session");
});

describe("auth store", () => {
  it("seeds the bootstrap password and forces a change", () => {
    expect(store.verifyPassword("password123")).toBe(true);
    expect(store.verifyPassword("wrong")).toBe(false);
    expect(store.mustChangePassword()).toBe(true);
    // Persisted with 0600 perms.
    const mode = fs.statSync(path.join(TMP, "auth.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("rotates the password and clears the forced-change flag", () => {
    store.setPassword("a-strong-secret");
    expect(store.verifyPassword("a-strong-secret")).toBe(true);
    expect(store.verifyPassword("password123")).toBe(false);
    expect(store.mustChangePassword()).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a freshly signed token", () => {
    const token = session.createSessionToken();
    expect(session.verifySessionToken(token)).toBe(true);
  });

  it("rejects tampered, malformed, and empty tokens", () => {
    const token = session.createSessionToken();
    expect(session.verifySessionToken(token + "x")).toBe(false);
    expect(session.verifySessionToken("not-a-token")).toBe(false);
    expect(session.verifySessionToken("")).toBe(false);
    expect(session.verifySessionToken(undefined)).toBe(false);
  });

  it("rejects an expired token", () => {
    const expired = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 }))
      .toString("base64url");
    // Re-sign with the real secret so only expiry fails.
    const sig = createHmac("sha256", store.getAuthSecret())
      .update(expired)
      .digest("base64url");
    expect(session.verifySessionToken(`${expired}.${sig}`)).toBe(false);
  });
});
