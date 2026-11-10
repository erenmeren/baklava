import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isLegacyEncrypted } from "@/lib/crypto/secret-file";

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
// other file under ~/.baklava, the log is 0600: one JSON line per entry keeps
// it append-only.
export function appendAudit(sessionId: string, entry: AuditEntry): void {
  try {
    fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
    fs.appendFileSync(auditPath(sessionId), JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch (err) {
    console.error("[baklava] audit append failed:", err);
  }
}

/** Entries of one session's log (lines encrypted by older versions can't be read and are skipped). */
export function readAudit(sessionId: string): AuditEntry[] {
  let text: string;
  try {
    text = fs.readFileSync(auditPath(sessionId), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.trim() && !isLegacyEncrypted(l))
    .map((l) => JSON.parse(l) as AuditEntry);
}
