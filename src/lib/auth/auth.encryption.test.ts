import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
const CACHE = Symbol.for("baklava.authState");
const MK_CACHE = Symbol.for("baklava.masterKeyMaterial");

function clearCaches() {
  delete (globalThis as Record<symbol, unknown>)[CACHE];
  delete (globalThis as Record<symbol, unknown>)[MK_CACHE];
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-auth-enc-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_MASTER_KEY = "unit-test-master-key";
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
  // Re-evaluate store.ts so its module-level DATA_DIR/FILE pick up this temp dir.
  vi.resetModules();
  clearCaches();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_MASTER_KEY;
  delete process.env.BAKLAVA_DATA_DIR;
  delete process.env.BAKLAVA_INITIAL_PASSWORD;
});

describe("auth.json encryption", () => {
  it("persists auth.json encrypted (envelope, not plaintext) and round-trips secret + password", async () => {
    const store = await import("./store");
    store.setPassword("hunter2");
    const secret = store.getAuthSecret();
    expect(secret).toBeTruthy();
    expect(store.verifyPassword("hunter2")).toBe(true);

    const file = path.join(dir, "auth.json");
    const onDisk = fs.readFileSync(file, "utf8");
    // Encrypted: the envelope magic is present, and the secret is NOT in cleartext.
    expect(onDisk).toContain("baklava-enc");
    expect(onDisk).not.toContain(secret);
    // It must NOT be the plaintext AuthState JSON.
    const parsed = JSON.parse(onDisk) as Record<string, unknown>;
    expect(parsed.magic).toBe("baklava-enc");
    expect(parsed.secret).toBeUndefined();
    expect(parsed.passwordHash).toBeUndefined();

    // 0o600 on disk.
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);

    // Fresh load (cache cleared) round-trips the same secret + verifies password.
    clearCaches();
    const store2 = await import("./store");
    expect(store2.getAuthSecret()).toBe(secret);
    expect(store2.verifyPassword("hunter2")).toBe(true);
    expect(store2.verifyPassword("wrong")).toBe(false);
  });

  it("migrates a legacy plaintext auth.json to encrypted, preserving secret + passwordHash", async () => {
    const file = path.join(dir, "auth.json");

    // Build a legacy plaintext auth.json (old format) with a known scrypt hash.
    const { scryptSync } = await import("node:crypto");
    const salt = "0011223344556677889900aabbccddeeff";
    const passwordHash = scryptSync("legacy-pass", Buffer.from(salt, "hex"), 64).toString("hex");
    const secret = "abc123def456abc123def456abc123def456abc123def456abc123def456abcd";
    const legacy = {
      version: 1,
      salt,
      passwordHash,
      secret,
      mustChange: false,
      enabled: true,
      updatedAt: 1700000000000,
    };
    fs.writeFileSync(file, JSON.stringify(legacy, null, 2), { mode: 0o600 });
    // Sanity: it is plaintext, not an envelope.
    expect(fs.readFileSync(file, "utf8")).not.toContain("baklava-enc");

    // Load the legacy file — must work and surface the legacy secret/password.
    const store = await import("./store");
    expect(store.getAuthSecret()).toBe(secret);
    expect(store.verifyPassword("legacy-pass")).toBe(true);

    // Trigger a persist (toggle the gate — does not touch secret/passwordHash).
    store.setAuthEnabled(true);

    // Now encrypted on disk, secret + passwordHash unchanged after a fresh load.
    const onDisk = fs.readFileSync(file, "utf8");
    expect(onDisk).toContain("baklava-enc");
    expect(onDisk).not.toContain(secret);
    expect(onDisk).not.toContain(passwordHash);

    clearCaches();
    const store2 = await import("./store");
    expect(store2.getAuthSecret()).toBe(secret);
    expect(store2.verifyPassword("legacy-pass")).toBe(true);

    // The pre-encryption backup of the plaintext file was written.
    expect(fs.existsSync(`${file}.pre-encryption.bak`)).toBe(true);
  });
});
