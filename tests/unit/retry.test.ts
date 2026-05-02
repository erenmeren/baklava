import { describe, it, expect, vi } from "vitest";
import { generatePlanWithRetry } from "../../lib/ai/retry.js";
import type { PlanGenerator, RawPlan } from "../../lib/ai/plan.js";

const baseInput = {
  nl: "list pro users",
  connections: [
    {
      connection: "pg",
      plugin: "postgres",
      tables: [
        {
          table: "users",
          tableAlias: "pg__users",
          columns: [
            { name: "id", duckdbType: "INTEGER", nullable: false },
            { name: "plan_tier", duckdbType: "VARCHAR", nullable: true },
          ],
        },
      ],
    },
  ],
};

const goodPlan: RawPlan = {
  plan_english: "Select pro users.",
  sources: [{ connection: "pg", table: "users" }],
  sql: "SELECT id FROM pg__users WHERE plan_tier = 'pro'",
};

const badPlan: RawPlan = {
  plan_english: "Select all users.",
  sources: [{ connection: "pg", table: "users" }],
  sql: "SELECT * FROM phantom_table",
};

function generatorReturning(...plans: RawPlan[]): PlanGenerator {
  let i = 0;
  return async () => {
    const plan = plans[i++];
    if (!plan) throw new Error("test generator ran out of canned plans");
    return JSON.stringify(plan);
  };
}

describe("generatePlanWithRetry", () => {
  it("returns immediately on a first-attempt valid plan", async () => {
    const validate = vi.fn(async () => ({ ok: true as const }));
    const result = await generatePlanWithRetry({
      ...baseInput,
      generator: generatorReturning(goodPlan),
      validate,
    });
    expect(result.attempts).toBe(1);
    expect(result.plan.sql).toContain("SELECT id");
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first plan is rejected, accepts the second", async () => {
    const validate = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "phantom_table not in declared sources" })
      .mockResolvedValueOnce({ ok: true });
    const result = await generatePlanWithRetry({
      ...baseInput,
      generator: generatorReturning(badPlan, goodPlan),
      validate,
    });
    expect(result.attempts).toBe(2);
    expect(result.plan.sql).toContain("SELECT id");
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it("throws when both attempts fail", async () => {
    const validate = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "phantom_table not declared" })
      .mockResolvedValueOnce({ ok: false, reason: "still wrong" });
    await expect(
      generatePlanWithRetry({
        ...baseInput,
        generator: generatorReturning(badPlan, badPlan),
        validate,
      })
    ).rejects.toThrow(/E_AI_PLAN_VALIDATION_FAILED|twice/i);
  });

  it("feeds the first failure reason into the second prompt", async () => {
    const generator = vi.fn();
    generator.mockResolvedValueOnce(JSON.stringify(badPlan));
    generator.mockResolvedValueOnce(JSON.stringify(goodPlan));

    const validate = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "phantom_table not declared" })
      .mockResolvedValueOnce({ ok: true });

    await generatePlanWithRetry({
      ...baseInput,
      generator: generator as unknown as PlanGenerator,
      validate,
    });

    const secondCall = generator.mock.calls[1]![0] as { user: string };
    expect(secondCall.user).toContain("previous SQL was rejected");
    expect(secondCall.user).toContain("phantom_table not declared");
  });
});
