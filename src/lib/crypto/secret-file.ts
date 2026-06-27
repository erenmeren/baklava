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
