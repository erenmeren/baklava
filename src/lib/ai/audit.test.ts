import { describe, it, expect } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { appendAudit, auditPath } from "./audit";

describe("audit log", () => {
  it("appends one JSON line per call", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-aud-"));
    process.env.BAKLAVA_DATA_DIR = dir;
    appendAudit("sess1", { tool: "docker_action", category: "write", connectionId: "c1", userId: "u1", args: { action: "restart" }, decision: "executed", at: 1 });
    appendAudit("sess1", { tool: "pg_run_sql", category: "read", connectionId: "c1", userId: "u1", args: {}, decision: "executed", at: 2 });
    const lines = fs.readFileSync(auditPath("sess1"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).tool).toBe("docker_action");
    expect(JSON.parse(lines[0]).userId).toBe("u1");
    expect(JSON.parse(lines[1]).category).toBe("read");
  });
});
