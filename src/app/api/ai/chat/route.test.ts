import { describe, it, expect, vi } from "vitest";
import { buildPlanAdditions } from "./route";
import { PLAN_TOOL_NAME } from "@/lib/ai/plan-tool";

const ctx = { sessionId: "s1", emit: vi.fn() };
const BASE = "Connections in this conversation: prod (postgres). You may only act on these.";

describe("buildPlanAdditions", () => {
  it("plan mode off: leaves systemExtra unchanged and adds no tools", () => {
    const { systemExtra, extraTools } = buildPlanAdditions(false, BASE, ctx);
    expect(systemExtra).toBe(BASE);
    expect(systemExtra).not.toContain("PLAN MODE");
    expect(extraTools).toHaveLength(0);
  });

  it("plan mode undefined behaves like off", () => {
    const { systemExtra, extraTools } = buildPlanAdditions(undefined, BASE, ctx);
    expect(systemExtra).toBe(BASE);
    expect(extraTools).toHaveLength(0);
  });

  it("plan mode on: appends the PLAN MODE directive to systemExtra", () => {
    const { systemExtra } = buildPlanAdditions(true, BASE, ctx);
    expect(systemExtra).toContain(BASE);
    expect(systemExtra).toContain("PLAN MODE");
    expect(systemExtra).toContain(PLAN_TOOL_NAME);
    expect(systemExtra).toContain("approved: true");
  });

  it("plan mode on: adds exactly one tool named propose_plan", () => {
    const { extraTools } = buildPlanAdditions(true, BASE, ctx);
    expect(extraTools).toHaveLength(1);
    expect(extraTools[0].name).toBe(PLAN_TOOL_NAME);
    expect(typeof extraTools[0].run).toBe("function");
  });

  it("plan mode on with empty base still produces a non-empty directive", () => {
    const { systemExtra, extraTools } = buildPlanAdditions(true, "", ctx);
    expect(systemExtra).toContain("PLAN MODE");
    expect(extraTools).toHaveLength(1);
  });
});
