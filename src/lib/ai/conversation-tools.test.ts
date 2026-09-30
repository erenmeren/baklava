import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { AiTool } from "./tools/types";

process.env.BAKLAVA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "baklava-ct-"));

const pgExec = vi.fn(async () => ({ rows: [[1]] }));
const dockerExec = vi.fn(async () => ({ ok: true }));
const seenPolicies: Array<{ tech: string; policy: { allowK8sSecretValues?: boolean } }> = [];
vi.mock("./tools/registry", () => ({
  buildTools: (tech: string, _id: string, _cfg: unknown, policy: { allowK8sSecretValues?: boolean }) => {
    seenPolicies.push({ tech, policy });
    if (tech === "postgres")
      return [{ name: "pg_run_sql", description: "run sql", category: "read", inputSchema: z.object({ sql: z.string() }), execute: pgExec }] as AiTool[];
    if (tech === "docker")
      return [{ name: "docker_list_containers", description: "list", category: "read", inputSchema: z.object({}), execute: dockerExec }] as AiTool[];
    return [];
  },
  isAiSupported: () => true,
}));

import { buildConversationTools } from "./conversation-tools";
import { DEFAULT_POLICY } from "./permissions";

const base = { sessionId: "s1", userId: "u1", emit: vi.fn(), awaitApproval: vi.fn(async () => true) };
function conn(id: string, tech: "postgres" | "docker", name: string) {
  return { id, tech, name, config: {}, policy: DEFAULT_POLICY, access: "write" as const };
}

describe("buildConversationTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges same-named tools across connections into one tool with a connection enum", async () => {
    const tools = buildConversationTools([conn("a", "postgres", "prod"), conn("b", "postgres", "staging")], base);
    const sql = tools.find((t) => t.name === "pg_run_sql")!;
    expect(sql).toBeTruthy();
    expect(sql.inputSchema.safeParse({ sql: "select 1", connection: "prod" }).success).toBe(true);
    expect(sql.inputSchema.safeParse({ sql: "select 1", connection: "nope" }).success).toBe(false);
  });

  it("dispatches run to the chosen connection's execute", async () => {
    const tools = buildConversationTools([conn("a", "postgres", "prod"), conn("b", "postgres", "staging")], base);
    const sql = tools.find((t) => t.name === "pg_run_sql")!;
    await sql.run({ connection: "staging", sql: "select 1" }, "call1");
    expect(pgExec).toHaveBeenCalledWith({ sql: "select 1" });
  });

  it("unknown/missing connection returns an error, does not execute", async () => {
    const tools = buildConversationTools([conn("a", "postgres", "prod")], base);
    const sql = tools.find((t) => t.name === "pg_run_sql")!;
    const out = await sql.run({ sql: "select 1" }, "call1");
    expect(pgExec).not.toHaveBeenCalled();
    expect(out).toMatchObject({ error: expect.stringContaining("connection") });
  });

  it("mixed-tech set yields per-tech tools each scoped to their tech's connections", () => {
    const tools = buildConversationTools([conn("a", "postgres", "prod"), conn("c", "docker", "local")], base);
    expect(tools.map((t) => t.name).sort()).toEqual(["docker_list_containers", "pg_run_sql"]);
  });

  it("empty set yields no tools", () => {
    expect(buildConversationTools([], base)).toEqual([]);
  });

  it("k8s Secret values reach the tools only with a write grant, whatever the policy says", () => {
    const k8s = (access: "read" | "write") => ({
      id: `k-${access}`,
      tech: "kubernetes" as const,
      name: `k-${access}`,
      config: {},
      policy: { ...DEFAULT_POLICY, allowK8sSecretValues: true },
      access,
    });
    seenPolicies.length = 0;
    buildConversationTools([k8s("read"), k8s("write")], base);
    const byTech = seenPolicies.filter((p) => p.tech === "kubernetes").map((p) => p.policy.allowK8sSecretValues);
    expect(byTech).toEqual([false, true]);
  });
});
