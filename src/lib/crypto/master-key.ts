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

const saltCacheKey = Symbol.for("baklava.installSalt");

export function getInstallSalt(): Buffer {
  const g = globalThis as unknown as Record<symbol, Buffer>;
  if (g[saltCacheKey]) return g[saltCacheKey];
  const saltFile = path.join(dataDir(), "master.salt");
  let salt: Buffer;
  try {
    salt = Buffer.from(fs.readFileSync(saltFile, "utf8").trim(), "hex");
  } catch {
    salt = randomBytes(16);
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(saltFile, salt.toString("hex"), { mode: 0o600 });
  }
  return (g[saltCacheKey] = salt);
}

export function _resetKeyCacheForTests(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  delete g[cacheKey];
  delete g[Symbol.for("baklava.installSalt")];
  delete g[Symbol.for("baklava.kekCache")];
}
