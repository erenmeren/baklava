import { describe, it, expect } from "vitest";
import { generatePlan, type PlanGenerator } from "../../lib/ai/plan.js";

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

function fixedGenerator(response: string): PlanGenerator {
  return async () => response;
}

const validJson = JSON.stringify({
  plan_english: "Select pro users.",
  sources: [{ connection: "pg", table: "users" }],
  sql: "SELECT id FROM pg__users WHERE plan_tier = 'pro'",
});

describe("generatePlan — happy paths", () => {
  it("parses a clean JSON response", async () => {
    const plan = await generatePlan({ ...baseInput, generator: fixedGenerator(validJson) });
    expect(plan.plan_english).toBe("Select pro users.");
    expect(plan.sources).toEqual([{ connection: "pg", table: "users" }]);
    expect(plan.sql).toMatch(/SELECT id/);
  });

  it("strips a markdown ```json fence if the model adds one", async () => {
    const fenced = "```json\n" + validJson + "\n```";
    const plan = await generatePlan({ ...baseInput, generator: fixedGenerator(fenced) });
    expect(plan.sources).toHaveLength(1);
  });

  it("strips a bare ``` fence", async () => {
    const fenced = "```\n" + validJson + "\n```";
    const plan = await generatePlan({ ...baseInput, generator: fixedGenerator(fenced) });
    expect(plan.sources).toHaveLength(1);
  });

  it("trims surrounding whitespace", async () => {
    const padded = "\n\n   " + validJson + "\n  ";
    const plan = await generatePlan({ ...baseInput, generator: fixedGenerator(padded) });
    expect(plan.sources).toHaveLength(1);
  });
});

describe("generatePlan — shape errors", () => {
  it("rejects non-JSON output", async () => {
    await expect(
      generatePlan({ ...baseInput, generator: fixedGenerator("the plan is to query the users table") })
    ).rejects.toThrow(/E_AI_INVALID_PLAN|valid JSON/i);
  });

  it("rejects an array (not an object)", async () => {
    await expect(
      generatePlan({ ...baseInput, generator: fixedGenerator(JSON.stringify([{}, {}])) })
    ).rejects.toThrow(/E_AI_INVALID_PLAN/);
  });

  it("rejects a missing plan_english", async () => {
    const bad = JSON.stringify({
      sources: [{ connection: "pg", table: "users" }],
      sql: "SELECT id FROM pg__users",
    });
    await expect(
      generatePlan({ ...baseInput, generator: fixedGenerator(bad) })
    ).rejects.toThrow(/E_AI_INVALID_PLAN|plan_english/);
  });

  it("rejects a missing sql", async () => {
    const bad = JSON.stringify({
      plan_english: "x",
      sources: [{ connection: "pg", table: "users" }],
    });
    await expect(
      generatePlan({ ...baseInput, generator: fixedGenerator(bad) })
    ).rejects.toThrow(/E_AI_INVALID_PLAN|sql/);
  });

  it("rejects a non-array sources field", async () => {
    const bad = JSON.stringify({
      plan_english: "x",
      sources: "pg.users",
      sql: "SELECT 1",
    });
    await expect(
      generatePlan({ ...baseInput, generator: fixedGenerator(bad) })
    ).rejects.toThrow(/E_AI_INVALID_PLAN|sources/);
  });

  it("rejects sources entries missing connection or table", async () => {
    const bad = JSON.stringify({
      plan_english: "x",
      sources: [{ connection: "pg" }],
      sql: "SELECT 1",
    });
    await expect(
      generatePlan({ ...baseInput, generator: fixedGenerator(bad) })
    ).rejects.toThrow(/E_AI_INVALID_PLAN|source/);
  });
});
