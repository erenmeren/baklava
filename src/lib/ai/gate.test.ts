import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import { wrapExecute } from "./gate";
import { DEFAULT_POLICY } from "./permissions";
import type { AiTool } from "./tools/types";
import * as audit from "./audit";

vi.mock("./audit", () => ({ appendAudit: vi.fn() }));

function tool(category: AiTool["category"], exec: AiTool["execute"] = vi.fn(async () => ({ ok: true }))): AiTool {
  return { name: `t_${category}`, description: "", category, inputSchema: z.object({}), execute: exec };
}

function ctx(overrides: Partial<Parameters<typeof wrapExecute>[1]> = {}) {
  return {
    policy: DEFAULT_POLICY,
    connectionId: "c1",
    sessionId: "s1",
    emit: vi.fn(),
    awaitApproval: vi.fn(async () => true),
    now: () => 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("wrapExecute", () => {
  it("read tools run without approval and are audited as executed", async () => {
    const exec = vi.fn(async () => ({ rows: [] }));
    const c = ctx();
    const run = wrapExecute(tool("read", exec), c);
    const out = await run({});
    expect(exec).toHaveBeenCalled();
    expect(c.awaitApproval).not.toHaveBeenCalled();
    expect(out).toEqual({ rows: [] });
  });

  it("confirm mode: write tool requests approval, runs on approve", async () => {
    const exec = vi.fn(async () => ({ ok: true }));
    const c = ctx({ policy: { ...DEFAULT_POLICY, write: true }, awaitApproval: vi.fn(async () => true) });
    const run = wrapExecute(tool("write", exec), c);
    await run({ action: "restart" });
    expect(c.awaitApproval).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });

  it("confirm mode: rejected approval does NOT run, returns a declined result", async () => {
    const exec = vi.fn(async () => ({ ok: true }));
    const c = ctx({ policy: { ...DEFAULT_POLICY, write: true }, awaitApproval: vi.fn(async () => false) });
    const run = wrapExecute(tool("write", exec), c);
    const out = await run({});
    expect(exec).not.toHaveBeenCalled();
    expect(out).toMatchObject({ declined: true });
  });

  it("never executes a category the policy disallows, even if asked directly", async () => {
    const exec = vi.fn(async () => ({ ok: true }));
    const c = ctx({ policy: { ...DEFAULT_POLICY } });
    const run = wrapExecute(tool("destructive", exec), c);
    const out = await run({});
    expect(exec).not.toHaveBeenCalled();
    expect(out).toMatchObject({ error: expect.stringContaining("not permitted") });
  });

  it("execution errors are caught and returned to the model (not thrown)", async () => {
    const exec = vi.fn(async () => { throw new Error("kaboom"); });
    const c = ctx();
    const run = wrapExecute(tool("read", exec), c);
    const out = await run({});
    expect(out).toMatchObject({ error: expect.stringContaining("kaboom") });
  });
});

describe("gate audit", () => {
  it("allowed read is audited as 'executed'", async () => {
    const c = ctx();
    const run = wrapExecute(tool("read"), c);
    await run({}, "tc-1");
    expect(audit.appendAudit).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ decision: "executed" }),
    );
  });

  it("declined approval is audited as 'rejected'", async () => {
    const c = ctx({
      policy: { ...DEFAULT_POLICY, write: true },
      awaitApproval: vi.fn(async () => false),
    });
    const run = wrapExecute(tool("write"), c);
    await run({}, "tc-2");
    expect(audit.appendAudit).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ decision: "rejected" }),
    );
  });

  it("disallowed category is audited as 'blocked'", async () => {
    // DEFAULT_POLICY has destructive: false
    const c = ctx();
    const run = wrapExecute(tool("destructive"), c);
    await run({}, "tc-3");
    expect(audit.appendAudit).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ decision: "blocked" }),
    );
  });

  it("execute throwing is audited as 'error'", async () => {
    const exec = vi.fn(async () => { throw new Error("boom"); });
    const c = ctx();
    const run = wrapExecute(tool("read", exec), c);
    await run({}, "tc-4");
    expect(audit.appendAudit).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ decision: "error" }),
    );
  });
});

describe("autonomous mode at the gate", () => {
  it("autonomous + destructive: awaitApproval IS called (confirmDestructive defaults to true)", async () => {
    const exec = vi.fn(async () => ({ ok: true }));
    const c = ctx({
      policy: { mode: "autonomous", read: true, write: true, destructive: true },
      awaitApproval: vi.fn(async () => true),
    });
    const run = wrapExecute(tool("destructive", exec), c);
    await run({}, "tc-5");
    expect(c.awaitApproval).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });

  it("autonomous + destructive + confirmDestructive:false: awaitApproval NOT called, exec IS called", async () => {
    const exec = vi.fn(async () => ({ ok: true }));
    const c = ctx({
      policy: { mode: "autonomous", read: true, write: true, destructive: true, confirmDestructive: false },
      awaitApproval: vi.fn(async () => true),
    });
    const run = wrapExecute(tool("destructive", exec), c);
    await run({}, "tc-6");
    expect(c.awaitApproval).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });
});
