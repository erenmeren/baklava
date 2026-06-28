import { describe, it, expect, vi } from "vitest";
import { resolvePending } from "./pending";
import { makeProposePlanTool, PLAN_TOOL_NAME, type PlanStep } from "./plan-tool";

const STEPS: PlanStep[] = [
  { tool: "pg_run_sql", connection: "prod", summary: "Backfill the missing rows" },
  { tool: "docker_restart", summary: "Restart the worker container" },
];

describe("makeProposePlanTool", () => {
  it("exposes the PreparedTool shape with the right name", () => {
    const t = makeProposePlanTool({ sessionId: "s1", emit: vi.fn() });
    expect(t.name).toBe(PLAN_TOOL_NAME);
    expect(typeof t.description).toBe("string");
    expect(t.description.length).toBeGreaterThan(0);
    expect(typeof t.run).toBe("function");
    expect(t.inputSchema).toBeDefined();
  });

  it("emits a `plan` event with toolCallId, steps, and rationale", async () => {
    const emit = vi.fn();
    const t = makeProposePlanTool({ sessionId: "s1", emit });
    const p = t.run({ steps: STEPS, rationale: "because" }, "call1");
    // emit must happen synchronously before we resolve the pending decision
    expect(emit).toHaveBeenCalledWith("plan", {
      toolCallId: "call1",
      steps: STEPS,
      rationale: "because",
    });
    resolvePending("s1", "call1", true);
    await p;
  });

  it("returns { approved: true } after the pending decision approves", async () => {
    const t = makeProposePlanTool({ sessionId: "s2", emit: vi.fn() });
    const p = t.run({ steps: STEPS }, "call2");
    queueMicrotask(() => resolvePending("s2", "call2", true));
    await expect(p).resolves.toEqual({ approved: true });
  });

  it("returns { approved: false } after the pending decision rejects", async () => {
    const t = makeProposePlanTool({ sessionId: "s3", emit: vi.fn() });
    const p = t.run({ steps: STEPS }, "call3");
    queueMicrotask(() => resolvePending("s3", "call3", false));
    await expect(p).resolves.toEqual({ approved: false });
  });

  it("uses a custom awaitDecision when provided", async () => {
    const awaitDecision = vi.fn(async () => true);
    const t = makeProposePlanTool({ sessionId: "s4", emit: vi.fn(), awaitDecision });
    await expect(t.run({ steps: STEPS, rationale: "r" }, "call4")).resolves.toEqual({
      approved: true,
    });
    expect(awaitDecision).toHaveBeenCalledWith("call4", { steps: STEPS, rationale: "r" });
  });

  it("rejects input with an empty steps array", async () => {
    const t = makeProposePlanTool({ sessionId: "s5", emit: vi.fn() });
    const parsed = t.inputSchema.safeParse({ steps: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects steps missing required fields", async () => {
    const t = makeProposePlanTool({ sessionId: "s6", emit: vi.fn() });
    const parsed = t.inputSchema.safeParse({ steps: [{ connection: "x" }] });
    expect(parsed.success).toBe(false);
  });

  it("accepts valid input (connection optional)", async () => {
    const t = makeProposePlanTool({ sessionId: "s7", emit: vi.fn() });
    const parsed = t.inputSchema.safeParse({ steps: [{ tool: "a", summary: "b" }] });
    expect(parsed.success).toBe(true);
  });

  it("has no side effects beyond emit + await (emits exactly once, only `plan`)", async () => {
    const emit = vi.fn();
    const t = makeProposePlanTool({ sessionId: "s8", emit });
    const p = t.run({ steps: STEPS }, "call8");
    resolvePending("s8", "call8", true);
    await p;
    // only the single plan emit, no tool-result / blocked / audit events etc.
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toBe("plan");
  });
});
