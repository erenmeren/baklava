import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveKeyMaterial, _resetKeyCacheForTests, type Keychain } from "./master-key";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-key-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  delete process.env.BAKLAVA_MASTER_KEY;
  _resetKeyCacheForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_MASTER_KEY;
});

describe("resolveKeyMaterial", () => {
  it("prefers the env var", () => {
    process.env.BAKLAVA_MASTER_KEY = "env-secret";
    const r = resolveKeyMaterial({ keychain: { get: () => "kc", set: () => {} } });
    expect(r.source).toBe("env");
    expect(r.material.toString("utf8")).toBe("env-secret");
  });

  it("uses the keychain when no env var", () => {
    const store: { v: string | null } = { v: null };
    const kc: Keychain = { get: () => store.v, set: (v) => (store.v = v) };
    const r = resolveKeyMaterial({ keychain: kc });
    expect(r.source).toBe("keychain");
    expect(store.v).not.toBeNull();
  });

  it("falls back to a 0600 key-file when no env and no keychain", () => {
    const r = resolveKeyMaterial({ keychain: null });
    expect(r.source).toBe("file");
    const keyPath = path.join(dir, "master.key");
    expect(fs.existsSync(keyPath)).toBe(true);
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  it("is stable across calls (file path returns same material)", () => {
    const a = resolveKeyMaterial({ keychain: null }).material.toString();
    _resetKeyCacheForTests();
    const b = resolveKeyMaterial({ keychain: null }).material.toString();
    expect(a).toBe(b);
  });
});

describe("resolveKeyMaterial — key-file hygiene", () => {
  it("refuses an empty master.key instead of using a zero-length key", () => {
    fs.writeFileSync(path.join(dir, "master.key"), "  \n");
    expect(() => resolveKeyMaterial({ keychain: null })).toThrow(/empty/);
  });

  it("tightens a key file that was copied in world-readable", () => {
    const keyPath = path.join(dir, "master.key");
    fs.writeFileSync(keyPath, "existing-key", { mode: 0o644 });
    fs.chmodSync(keyPath, 0o644);
    expect(resolveKeyMaterial({ keychain: null }).material.toString()).toBe("existing-key");
    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
  });
});
