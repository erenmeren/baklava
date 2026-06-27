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

  // Never overwrite an existing file we cannot reproduce. Back it up once:
  // legacy plaintext, or an envelope we can't decrypt (lost/changed key).
  try {
    const existing = fs.readFileSync(file, "utf8");
    if (!isEnvelope(existing)) {
      backupOnce(`${file}.pre-encryption.bak`, existing);
    } else if (!canDecrypt(existing)) {
      backupOnce(`${file}.unreadable.bak`, existing);
    }
  } catch {
    /* no existing file — nothing to back up */
  }

  const envelope = encryptEnvelope(plaintext, resolveKeyMaterial().material);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, envelope, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function backupOnce(bakPath: string, content: string): void {
  if (fs.existsSync(bakPath)) return; // don't clobber an earlier backup
  fs.writeFileSync(bakPath, content, { mode: 0o600 });
}

function canDecrypt(envelopeText: string): boolean {
  try {
    decryptEnvelope(envelopeText, resolveKeyMaterial().material);
    return true;
  } catch {
    return false;
  }
}
