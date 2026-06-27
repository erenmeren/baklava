import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSecretFileSync, writeSecretFileSync } from "./secret-file";
import { _resetKeyCacheForTests, resolveKeyMaterial } from "./master-key";
import { decryptEnvelope } from "./envelope";

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-sf-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_MASTER_KEY = "unit-test-master-key";
  file = path.join(dir, "connections.json");
  _resetKeyCacheForTests();
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_MASTER_KEY;
});

describe("secret-file", () => {
  it("returns null for a missing file", () => {
    expect(readSecretFileSync(file)).toBeNull();
  });

  it("round-trips and stores ciphertext on disk", () => {
    const blob = JSON.stringify({ secret: "hunter2" });
    writeSecretFileSync(file, blob);
    const onDisk = fs.readFileSync(file, "utf8");
    expect(onDisk).not.toContain("hunter2");
    expect(onDisk).toContain("baklava-enc");
    expect(readSecretFileSync(file)).toBe(blob);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("reads a legacy plaintext file as-is", () => {
    const legacy = JSON.stringify({ version: 1, connections: [{ secret: "old" }] });
    fs.writeFileSync(file, legacy);
    expect(readSecretFileSync(file)).toBe(legacy);
  });

  it("backs up a legacy plaintext file once on first encrypted write", () => {
    fs.writeFileSync(file, JSON.stringify({ plaintext: "yes" }));
    writeSecretFileSync(file, JSON.stringify({ now: "encrypted" }));
    const bak = `${file}.pre-encryption.bak`;
    expect(fs.existsSync(bak)).toBe(true);
    expect(fs.readFileSync(bak, "utf8")).toContain("plaintext");
    const firstBak = fs.readFileSync(bak, "utf8");
    writeSecretFileSync(file, JSON.stringify({ now: "again" }));
    expect(fs.readFileSync(bak, "utf8")).toBe(firstBak);
  });

  it("backs up an undecryptable envelope instead of destroying it (key change)", () => {
    process.env.BAKLAVA_MASTER_KEY = "key-A";
    _resetKeyCacheForTests();
    writeSecretFileSync(file, JSON.stringify({ secret: "from-key-A" }));

    // Simulate a different/lost key on the next write.
    process.env.BAKLAVA_MASTER_KEY = "key-B";
    _resetKeyCacheForTests();
    writeSecretFileSync(file, JSON.stringify({ secret: "from-key-B" }));

    const bak = `${file}.unreadable.bak`;
    expect(fs.existsSync(bak)).toBe(true);
    // The original ciphertext is preserved and still decrypts with key-A.
    process.env.BAKLAVA_MASTER_KEY = "key-A";
    _resetKeyCacheForTests();
    const recovered = decryptEnvelope(fs.readFileSync(bak, "utf8"), resolveKeyMaterial().material);
    expect(recovered).toBe(JSON.stringify({ secret: "from-key-A" }));
  });
});
