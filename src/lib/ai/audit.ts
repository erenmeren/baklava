import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decryptEnvelope, encryptEnvelope, isEnvelope } from "@/lib/crypto/envelope";
import { getInstallSalt, resolveKeyMaterial } from "@/lib/crypto/master-key";

export interface AuditEntry {
  tool: string;
  category: "read" | "write" | "destructive";
  connectionId: string;
  userId: string;
  args: unknown;
  decision: string;
  summary?: string;
  at: number;
}

function dir(): string {
  const base = process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
  return path.join(base, "ai-audit");
}

export function auditPath(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(dir(), `${safe}.jsonl`);
}

// Entries carry tool arguments — SQL text, keys, manifests — so, like every
// other file under ~/.baklava, they're encrypted at rest: one compact
// envelope per line keeps the log append-only.
export function appendAudit(sessionId: string, entry: AuditEntry): void {
  try {
    fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
    const sealed = encryptEnvelope(JSON.stringify(entry), resolveKeyMaterial().material, getInstallSalt());
    fs.appendFileSync(auditPath(sessionId), JSON.stringify(JSON.parse(sealed)) + "\n", { mode: 0o600 });
  } catch (err) {
    console.error("[baklava] audit append failed:", err);
  }
}

/** Decrypted entries of one session's log (plaintext lines from older versions pass through). */
export function readAudit(sessionId: string): AuditEntry[] {
  let text: string;
  try {
    text = fs.readFileSync(auditPath(sessionId), "utf8");
  } catch {
    return [];
  }
  const material = resolveKeyMaterial().material;
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(isEnvelope(l) ? decryptEnvelope(l, material) : l) as AuditEntry);
}
