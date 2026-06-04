import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AuditEntry {
  tool: string;
  category: "read" | "write" | "destructive";
  connectionId: string;
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

export function appendAudit(sessionId: string, entry: AuditEntry): void {
  try {
    fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
    fs.appendFileSync(auditPath(sessionId), JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch (err) {
    console.error("[baklava] audit append failed:", err);
  }
}
