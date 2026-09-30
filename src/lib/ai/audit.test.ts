import { describe, it, expect } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { appendAudit, auditPath, readAudit } from "./audit";

describe("audit log", () => {
  it("appends one encrypted line per call and reads them back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-aud-"));
    process.env.BAKLAVA_DATA_DIR = dir;
    appendAudit("sess1", { tool: "docker_action", category: "write", connectionId: "c1", userId: "u1", args: { action: "restart" }, decision: "executed", at: 1 });
    appendAudit("sess1", { tool: "pg_run_sql", category: "read", connectionId: "c1", userId: "u1", args: { sql: "select secret_col" }, decision: "executed", at: 2 });
    const raw = fs.readFileSync(auditPath("sess1"), "utf8");
    expect(raw.trim().split("\n")).toHaveLength(2);
    expect(raw).not.toContain("secret_col");
    const entries = readAudit("sess1");
    expect(entries.map((e) => e.tool)).toEqual(["docker_action", "pg_run_sql"]);
    expect(entries[0].userId).toBe("u1");
    expect(entries[1].category).toBe("read");
  });

  it("still reads plaintext lines written by older versions", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-aud-"));
    process.env.BAKLAVA_DATA_DIR = dir;
    fs.mkdirSync(path.dirname(auditPath("old")), { recursive: true });
    fs.writeFileSync(auditPath("old"), JSON.stringify({ tool: "legacy", at: 1 }) + "\n");
    appendAudit("old", { tool: "new", category: "read", connectionId: "c", userId: "u", args: {}, decision: "executed", at: 2 });
    expect(readAudit("old").map((e) => e.tool)).toEqual(["legacy", "new"]);
  });
});
