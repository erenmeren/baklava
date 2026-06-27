# Credential Encryption at Rest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encrypt `~/.baklava/connections.json` and `~/.baklava/loadtests.json` at rest with a layered master key (env → OS keychain → key-file), migrating existing plaintext files automatically.

**Architecture:** A reusable `src/lib/crypto/` module does envelope encryption (random DEK encrypts the file blob with AES-256-GCM; the DEK is wrapped by a KEK derived via scrypt from resolved key material). A `secret-file` helper swaps the raw `fs.read/writeFileSync` calls in the two stores. All code is synchronous (node:crypto + @napi-rs/keyring are sync), so the existing sync `getStore()` path is untouched. Reading a legacy plaintext file passes through transparently; the next write encrypts it and leaves a one-time `.pre-encryption.bak`.

**Tech Stack:** TypeScript, Node `node:crypto` (AES-256-GCM, scrypt), `@napi-rs/keyring` (optional native dep, lazy `require`), vitest.

## Global Constraints

- Runtime is Node only; these modules run under `export const runtime = "nodejs"`. Exact values copied from the codebase:
- Data dir: `process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava")`.
- File modes: directories `0o700`, files `0o600` (match existing `store.ts`).
- Atomic writes: write to `${file}.tmp` then `fs.renameSync` (match existing `persistToDisk`).
- Cipher: AES-256-GCM via `node:crypto`. No new runtime crypto dependency. (XChaCha20-Poly1305 is a documented future option, not this plan.)
- Keychain dep `@napi-rs/keyring` is an **optionalDependency** and must be lazy-`require`d in a try/catch; absence falls back, never throws to the caller.
- Native deps used server-side must be added to `EXTRA_SERVER_PACKAGES` in `next.config.ts` (the tech-derived `serverExternalPackages` list is tech-only).
- Lint rule: no `require()` style imports is enabled project-wide; the one intentional `require` for the optional native module must carry an inline eslint-disable with a reason.
- Tests: vitest. Reset the global key cache and set `BAKLAVA_MASTER_KEY` + `BAKLAVA_DATA_DIR` (temp) per test for determinism.

**Deviation from spec (recorded):** spec said "master-password last resort." A Next server process cannot prompt interactively at store-load time, so the last resort is an auto-generated `~/.baklava/master.key` (0600), with a one-time warning that it provides no at-rest protection on its own. Deriving the KEK from the login password is a follow-up (needs a login-time key handoff).

---

### Task 1: Envelope crypto module

**Files:**
- Create: `src/lib/crypto/envelope.ts`
- Test: `src/lib/crypto/envelope.test.ts`

**Interfaces:**
- Consumes: nothing (pure, `node:crypto` only).
- Produces:
  - `encryptEnvelope(plaintext: string, material: Buffer): string`
  - `decryptEnvelope(text: string, material: Buffer): string` (throws on wrong key / tamper)
  - `isEnvelope(text: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/crypto/envelope.test.ts
import { describe, it, expect } from "vitest";
import { encryptEnvelope, decryptEnvelope, isEnvelope } from "./envelope";

const material = Buffer.from("test-key-material", "utf8");

describe("envelope", () => {
  it("round-trips plaintext", () => {
    const blob = JSON.stringify({ password: "hunter2", host: "db" });
    const enc = encryptEnvelope(blob, material);
    expect(enc).not.toContain("hunter2");
    expect(isEnvelope(enc)).toBe(true);
    expect(decryptEnvelope(enc, material)).toBe(blob);
  });

  it("fails with the wrong key", () => {
    const enc = encryptEnvelope("secret", material);
    expect(() => decryptEnvelope(enc, Buffer.from("wrong", "utf8"))).toThrow();
  });

  it("detects tampering", () => {
    const enc = encryptEnvelope("secret", material);
    const o = JSON.parse(enc);
    o.data.ct = Buffer.from("tampered").toString("base64");
    expect(() => decryptEnvelope(JSON.stringify(o), material)).toThrow();
  });

  it("isEnvelope is false for plaintext JSON", () => {
    expect(isEnvelope(JSON.stringify({ version: 1, connections: [] }))).toBe(false);
    expect(isEnvelope("not json")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/crypto/envelope.test.ts`
Expected: FAIL — cannot find module `./envelope`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/crypto/envelope.ts
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = "baklava-enc";
const VERSION = 1;
const SCRYPT = { N: 1 << 15, r: 8, p: 1 } as const; // ~30-60ms
const KEYLEN = 32;

interface GcmPart { iv: string; tag: string; ct: string }
interface Envelope {
  magic: typeof MAGIC;
  v: number;
  salt: string; // hex, for KEK derivation
  wrap: GcmPart; // DEK encrypted under KEK
  data: GcmPart; // plaintext encrypted under DEK
}

function deriveKek(material: Buffer, salt: Buffer): Buffer {
  return scryptSync(material, salt, KEYLEN, SCRYPT);
}

function gcmEncrypt(key: Buffer, plaintext: Buffer): GcmPart {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ct: ct.toString("base64") };
}

function gcmDecrypt(key: Buffer, part: GcmPart): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(part.iv, "hex"));
  decipher.setAuthTag(Buffer.from(part.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(part.ct, "base64")), decipher.final()]);
}

export function isEnvelope(text: string): boolean {
  try {
    const o = JSON.parse(text) as Partial<Envelope>;
    return o?.magic === MAGIC && typeof o.v === "number";
  } catch {
    return false;
  }
}

export function encryptEnvelope(plaintext: string, material: Buffer): string {
  const salt = randomBytes(16);
  const kek = deriveKek(material, salt);
  const dek = randomBytes(KEYLEN);
  const env: Envelope = {
    magic: MAGIC,
    v: VERSION,
    salt: salt.toString("hex"),
    wrap: gcmEncrypt(kek, dek),
    data: gcmEncrypt(dek, Buffer.from(plaintext, "utf8")),
  };
  return JSON.stringify(env, null, 2);
}

export function decryptEnvelope(text: string, material: Buffer): string {
  const env = JSON.parse(text) as Envelope;
  if (env.magic !== MAGIC) throw new Error("not a baklava envelope");
  const kek = deriveKek(material, Buffer.from(env.salt, "hex"));
  const dek = gcmDecrypt(kek, env.wrap);
  return gcmDecrypt(dek, env.data).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/crypto/envelope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/envelope.ts src/lib/crypto/envelope.test.ts
git commit -m "feat(crypto): AES-256-GCM envelope encrypt/decrypt for secret files"
```

---

### Task 2: Master-key resolver (env → keychain → key-file)

**Files:**
- Create: `src/lib/crypto/master-key.ts`
- Test: `src/lib/crypto/master-key.test.ts`
- Modify: `package.json` (add optionalDependency), `next.config.ts` (add to `EXTRA_SERVER_PACKAGES`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type KeySource = "env" | "keychain" | "file"`
  - `interface Keychain { get(): string | null; set(v: string): void }`
  - `resolveKeyMaterial(opts?: { keychain?: Keychain | null }): { material: Buffer; source: KeySource }` (cached on globalThis)
  - `_resetKeyCacheForTests(): void`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/crypto/master-key.test.ts
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
    expect(store.v).not.toBeNull(); // generated + stored
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/crypto/master-key.test.ts`
Expected: FAIL — cannot find module `./master-key`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/crypto/master-key.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type KeySource = "env" | "keychain" | "file";
export interface Keychain {
  get(): string | null;
  set(v: string): void;
}

const KEYCHAIN_SERVICE = "baklava";
const KEYCHAIN_ACCOUNT = "master-key";
const cacheKey = Symbol.for("baklava.masterKeyMaterial");

function dataDir(): string {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}

function realKeychain(): Keychain | null {
  try {
    // Optional native dep; absent on bare servers. Lazy require so a missing
    // module degrades to the file fallback instead of crashing import.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module
    const mod = require("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    const entry = new mod.Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    return {
      get: () => {
        try {
          return entry.getPassword();
        } catch {
          return null;
        }
      },
      set: (v) => entry.setPassword(v),
    };
  } catch {
    return null;
  }
}

export function resolveKeyMaterial(opts?: {
  keychain?: Keychain | null;
}): { material: Buffer; source: KeySource } {
  const g = globalThis as unknown as Record<symbol, { material: Buffer; source: KeySource }>;
  if (g[cacheKey]) return g[cacheKey];

  const env = process.env.BAKLAVA_MASTER_KEY;
  if (env && env.length > 0) {
    return (g[cacheKey] = { material: Buffer.from(env, "utf8"), source: "env" });
  }

  const kc = opts && "keychain" in opts ? opts.keychain : realKeychain();
  if (kc) {
    let key = kc.get();
    if (!key) {
      key = randomBytes(32).toString("base64");
      kc.set(key);
    }
    return (g[cacheKey] = { material: Buffer.from(key, "utf8"), source: "keychain" });
  }

  const keyFile = path.join(dataDir(), "master.key");
  let fileKey: string;
  try {
    fileKey = fs.readFileSync(keyFile, "utf8").trim();
  } catch {
    fileKey = randomBytes(32).toString("base64");
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(keyFile, fileKey, { mode: 0o600 });
    console.warn(
      "[baklava] No BAKLAVA_MASTER_KEY or OS keychain available; using ~/.baklava/master.key. " +
        "Set BAKLAVA_MASTER_KEY or install a keychain for real at-rest protection.",
    );
  }
  return (g[cacheKey] = { material: Buffer.from(fileKey, "utf8"), source: "file" });
}

export function _resetKeyCacheForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[cacheKey];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/crypto/master-key.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Declare the optional dependency and server-external package**

In `package.json`, add to `optionalDependencies` (keep the block alphabetized):

```json
    "@napi-rs/keyring": "^1.1.6",
```

In `next.config.ts`, extend the existing array:

```ts
const EXTRA_SERVER_PACKAGES = ["pdfkit", "@napi-rs/keyring"];
```

- [ ] **Step 6: Install and verify it still builds without the native module mattering**

Run: `npm install`
Expected: install completes (optional dep; OK if it fails to build on this platform).

Run: `npx vitest run src/lib/crypto/master-key.test.ts`
Expected: PASS (tests inject a fake keychain or use env/file; they never load the native module).

- [ ] **Step 7: Commit**

```bash
git add src/lib/crypto/master-key.ts src/lib/crypto/master-key.test.ts package.json package-lock.json next.config.ts
git commit -m "feat(crypto): layered master-key resolver (env > keychain > key-file)"
```

---

### Task 3: Encrypted secret-file helper with legacy passthrough + migration backup

**Files:**
- Create: `src/lib/crypto/secret-file.ts`
- Test: `src/lib/crypto/secret-file.test.ts`

**Interfaces:**
- Consumes: `encryptEnvelope`, `decryptEnvelope`, `isEnvelope` (Task 1); `resolveKeyMaterial` (Task 2).
- Produces:
  - `readSecretFileSync(file: string): string | null` — returns decrypted plaintext, the raw text for a legacy plaintext file, or `null` if the file is absent.
  - `writeSecretFileSync(file: string, plaintext: string): void` — atomically writes an envelope (0600), backing up a pre-existing plaintext file once to `${file}.pre-encryption.bak`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/crypto/secret-file.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSecretFileSync, writeSecretFileSync } from "./secret-file";
import { _resetKeyCacheForTests } from "./master-key";

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
    // Second write must not overwrite the backup (source is now an envelope).
    const firstBak = fs.readFileSync(bak, "utf8");
    writeSecretFileSync(file, JSON.stringify({ now: "again" }));
    expect(fs.readFileSync(bak, "utf8")).toBe(firstBak);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/crypto/secret-file.test.ts`
Expected: FAIL — cannot find module `./secret-file`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/crypto/secret-file.ts
import fs from "node:fs";
import path from "node:path";
import { decryptEnvelope, encryptEnvelope, isEnvelope } from "./envelope";
import { resolveKeyMaterial } from "./master-key";

export function readSecretFileSync(file: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (!isEnvelope(text)) return text; // legacy plaintext — pass through
  return decryptEnvelope(text, resolveKeyMaterial().material);
}

export function writeSecretFileSync(file: string, plaintext: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });

  // One-time backup of a pre-encryption plaintext file.
  try {
    const existing = fs.readFileSync(file, "utf8");
    if (!isEnvelope(existing)) {
      fs.writeFileSync(`${file}.pre-encryption.bak`, existing, { mode: 0o600 });
    }
  } catch {
    /* no existing file — nothing to back up */
  }

  const envelope = encryptEnvelope(plaintext, resolveKeyMaterial().material);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, envelope, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/crypto/secret-file.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto/secret-file.ts src/lib/crypto/secret-file.test.ts
git commit -m "feat(crypto): secret-file helper with legacy passthrough and one-time backup"
```

---

### Task 4: Encrypt the connections store

**Files:**
- Modify: `src/lib/connections/store.ts:29-62` (the `loadFromDisk` / `persistToDisk` bodies)
- Test: `src/lib/connections/store.encryption.test.ts`

**Interfaces:**
- Consumes: `readSecretFileSync`, `writeSecretFileSync` (Task 3).
- Produces: no API change — `saveConnection`, `getConnection`, etc. keep their signatures; only on-disk format changes.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connections/store.encryption.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-conn-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_MASTER_KEY = "unit-test-master-key";
  // Reset the connection store + key cache so each test loads fresh from disk.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.masterKeyMaterial")];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_MASTER_KEY;
});

describe("connections store encryption", () => {
  it("persists encrypted and reloads", async () => {
    const store = await import("./store");
    store.saveConnection({
      tech: "postgres",
      name: "db",
      config: { host: "h", password: "hunter2" },
      status: "untested",
    });
    const onDisk = fs.readFileSync(path.join(dir, "connections.json"), "utf8");
    expect(onDisk).not.toContain("hunter2");
    expect(onDisk).toContain("baklava-enc");

    // Fresh store instance reads it back.
    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.connectionStore")];
    const store2 = await import("./store");
    const all = store2.listConnections();
    expect(all.find((c) => c.name === "db")?.config).toMatchObject({ password: "hunter2" });
  });

  it("migrates a legacy plaintext file on next write", async () => {
    const file = path.join(dir, "connections.json");
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, connections: [
        { id: "x1", tech: "postgres", name: "legacy", config: { password: "old" }, status: "untested", createdAt: 1 },
      ] }),
    );
    const store = await import("./store");
    expect(store.getConnection("x1")?.name).toBe("legacy"); // reads plaintext
    store.saveConnection({ tech: "postgres", name: "new", config: {}, status: "untested" });
    const onDisk = fs.readFileSync(file, "utf8");
    expect(onDisk).toContain("baklava-enc"); // now encrypted
    expect(fs.existsSync(`${file}.pre-encryption.bak`)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/connections/store.encryption.test.ts`
Expected: FAIL — on-disk file still contains `hunter2` (plaintext), assertion fails.

- [ ] **Step 3: Edit `loadFromDisk` and `persistToDisk`**

Add the import at the top of `src/lib/connections/store.ts` (after the existing imports):

```ts
import { readSecretFileSync, writeSecretFileSync } from "@/lib/crypto/secret-file";
```

Replace the body of `loadFromDisk` (lines 29-49). The only change is the read call; parsing logic stays:

```ts
function loadFromDisk(): AnyRecord[] {
  try {
    const raw = readSecretFileSync(FILE);
    if (raw == null) return [];
    const data = JSON.parse(raw) as Partial<PersistedShape>;
    if (Array.isArray(data?.connections)) {
      return data.connections as AnyRecord[];
    }
    console.warn(`[baklava] ${FILE} has unexpected shape, ignoring (starting empty)`);
    return [];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn(`[baklava] could not read ${FILE}:`, err);
    }
    return [];
  }
}
```

Replace the body of `persistToDisk` (lines 51-62). The helper owns mkdir/atomic-write/0600:

```ts
function persistToDisk(records: AnyRecord[]): void {
  try {
    const payload: PersistedShape = { version: 1, connections: records };
    writeSecretFileSync(FILE, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error(`[baklava] could not persist ${FILE}:`, err);
  }
}
```

(The `fs`, `os`, `path` imports remain — `DATA_DIR`/`FILE` still use them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/connections/store.encryption.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/store.ts src/lib/connections/store.encryption.test.ts
git commit -m "feat(connections): encrypt connections.json at rest (auto-migrate legacy)"
```

---

### Task 5: Encrypt the load-test store

**Files:**
- Modify: `src/lib/loadtest/store.ts` (`loadFromDisk` and `persistToDisk`)
- Test: `src/lib/loadtest/store.encryption.test.ts`

**Interfaces:**
- Consumes: `readSecretFileSync`, `writeSecretFileSync` (Task 3).
- Produces: no API change.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/store.encryption.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-lt-"));
  process.env.BAKLAVA_DATA_DIR = dir;
  process.env.BAKLAVA_MASTER_KEY = "unit-test-master-key";
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.masterKeyMaterial")];
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.BAKLAVA_MASTER_KEY;
});

describe("loadtest store encryption", () => {
  it("persists bearer tokens encrypted", async () => {
    const store = await import("./store");
    store.saveLoadTest({
      name: "t",
      config: {
        target: { baseUrl: "http://example.com" },
        requests: [{ name: "r", method: "GET", path: "/" }],
        auth: { type: "bearer", token: "super-secret-token" },
        profile: { type: "constant", vus: 1, duration: "1s" },
        thresholds: undefined,
      },
    });
    const onDisk = fs.readFileSync(path.join(dir, "loadtests.json"), "utf8");
    expect(onDisk).not.toContain("super-secret-token");
    expect(onDisk).toContain("baklava-enc");

    delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
    const store2 = await import("./store");
    expect(store2.listLoadTests()[0].name).toBe("t");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/store.encryption.test.ts`
Expected: FAIL — on-disk file contains `super-secret-token`.

- [ ] **Step 3: Edit `loadtest/store.ts`**

Add the import near the top:

```ts
import { readSecretFileSync, writeSecretFileSync } from "@/lib/crypto/secret-file";
```

In `loadFromDisk`, replace `const raw = fs.readFileSync(FILE, "utf8");` with:

```ts
    const raw = readSecretFileSync(FILE);
    if (raw == null) return [];
```

and delete the now-redundant `ENOENT` special-casing only if it short-circuits on null (keep the outer try/catch). The `JSON.parse(raw)` line stays.

In `persistToDisk`, replace the `fs.mkdirSync` + `fs.writeFileSync(tmp, …)` + `fs.renameSync` block with:

```ts
    writeSecretFileSync(FILE, JSON.stringify(payload, null, 2));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/store.encryption.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/store.ts src/lib/loadtest/store.encryption.test.ts
git commit -m "feat(loadtest): encrypt loadtests.json at rest"
```

---

### Task 6: Recovery CLI — reveal the master key for backup

**Files:**
- Create: `scripts/show-master-key.ts`
- Modify: `package.json` (add `"baklava:show-key"` script)

**Interfaces:**
- Consumes: `resolveKeyMaterial` (Task 2).
- Produces: a CLI that prints the active key source and (for keychain/file sources) the base64 material to back up. For the `env` source it prints a reminder that the value is already in their environment.

Rationale: keychain users cannot otherwise read their key. Runs on the host only (no network surface), which fits a self-hosted operator. A Settings-page reveal is a follow-up.

- [ ] **Step 1: Write the implementation**

```ts
// scripts/show-master-key.ts
import { resolveKeyMaterial } from "@/lib/crypto/master-key";

const { material, source } = resolveKeyMaterial();
if (source === "env") {
  console.log("Key source: env (BAKLAVA_MASTER_KEY). It is already in your environment — back that value up.");
} else {
  console.log(`Key source: ${source}`);
  console.log("Master key (set this as BAKLAVA_MASTER_KEY to restore on another machine):");
  console.log(material.toString("utf8"));
  console.log("\nKeep this secret. Anyone with it can decrypt your stored credentials.");
}
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add:

```json
    "baklava:show-key": "tsx scripts/show-master-key.ts",
```

- [ ] **Step 3: Verify it runs**

Run: `BAKLAVA_MASTER_KEY=demo npm run baklava:show-key`
Expected: prints the env-source message.

Run (file source): `BAKLAVA_DATA_DIR=$(mktemp -d) env -u BAKLAVA_MASTER_KEY npm run baklava:show-key`
Expected: prints `Key source: file` and a base64 key.

- [ ] **Step 4: Commit**

```bash
git add scripts/show-master-key.ts package.json
git commit -m "feat(crypto): baklava:show-key CLI to back up the master key"
```

---

### Task 7: Docs + full regression + build

**Files:**
- Modify: `README.md` (security section), `AGENTS.md` (persistence note)

- [ ] **Step 1: Document the env var and key sources**

Add to the README security section (near the existing `BAKLAVA_INITIAL_PASSWORD` / data-dir docs): credentials in `~/.baklava/*.json` are encrypted at rest with AES-256-GCM; the master key comes from `BAKLAVA_MASTER_KEY` (recommended for Docker/headless), else the OS keychain, else `~/.baklava/master.key`; on first save an existing plaintext file is backed up to `*.pre-encryption.bak` (delete after verifying); `npm run baklava:show-key` reveals the key to back up; losing the key means re-entering connections.

- [ ] **Step 2: Update the AGENTS.md persistence bullet**

Update the "No DB" note in `AGENTS.md` to say connections/loadtests are encrypted at rest (envelope AES-256-GCM, key via env/keychain/key-file) rather than plaintext.

- [ ] **Step 3: Full gate**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no errors (the single intentional `require` carries its eslint-disable).

Run: `npm run test`
Expected: all green, including the new crypto + store encryption tests.

Run: `npm run build`
Expected: build succeeds; `@napi-rs/keyring` is treated as a server-external package (no bundling error).

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document credential encryption at rest and master-key sources"
```

---

## Self-Review

**Spec coverage** (against spec section 1):
- OS keychain integration → Task 2 (`@napi-rs/keyring`, lazy). ✅
- Master-password derived encryption → scrypt KEK derivation in Task 1; interactive password deferred (see Deviation). Partial, documented.
- Environment-based master key → Task 2 (`BAKLAVA_MASTER_KEY`, highest precedence). ✅
- libsodium / XChaCha20 → chose AES-256-GCM (zero-dep); XChaCha noted as future. ✅ (decision)
- Migration for existing users → Tasks 3-5 (plaintext passthrough + one-time backup). ✅
- Backup and recovery → Task 6 CLI + env hatch. ✅
- Cross-platform → keychain optional with file fallback. ✅
- Performance → scrypt N=2^15 (~30-60ms), one op per load/save. ✅

**Placeholder scan:** no TBD/TODO; every code step shows full code. ✅

**Type consistency:** `resolveKeyMaterial` returns `{ material: Buffer; source: KeySource }` and is consumed as `.material` in `secret-file.ts` and Task 6. `Keychain` shape (`get`/`set`) matches the injected fakes in tests. `readSecretFileSync`/`writeSecretFileSync` names match across Tasks 3-5. ✅

## Out of scope (follow-ups)
- KEK derived from the login password (needs a login-time key handoff; changes store load timing).
- Encrypting `auth.json` (already scrypt-hashed password + HMAC secret; lower priority).
- Settings-page key reveal (CLI covers the operator case for now).
- Key rotation UI (envelope supports it; no UI in this plan).
