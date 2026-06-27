import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = "baklava-enc";
const VERSION = 1;
// N=2^15 needs ~32MB; Node's default scrypt maxmem is 32MB and throws at the
// boundary, so raise maxmem rather than weaken the work factor.
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const; // ~30-60ms
const KEYLEN = 32;

interface GcmPart { iv: string; tag: string; ct: string }
interface Envelope {
  magic: typeof MAGIC;
  v: number;
  salt: string; // hex, for KEK derivation
  wrap: GcmPart; // DEK encrypted under KEK
  data: GcmPart; // plaintext encrypted under DEK
}

const kekCacheKey = Symbol.for("baklava.kekCache");
function kekCache(): Map<string, Buffer> {
  const g = globalThis as unknown as Record<symbol, Map<string, Buffer>>;
  if (!g[kekCacheKey]) g[kekCacheKey] = new Map();
  return g[kekCacheKey];
}
function deriveKek(material: Buffer, salt: Buffer): Buffer {
  const cacheId = `${material.toString("hex")}:${salt.toString("hex")}`;
  const cache = kekCache();
  const hit = cache.get(cacheId);
  if (hit) return hit;
  const kek = scryptSync(material, salt, KEYLEN, SCRYPT);
  cache.set(cacheId, kek);
  return kek;
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

export function encryptEnvelope(plaintext: string, material: Buffer, salt: Buffer = randomBytes(16)): string {
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
