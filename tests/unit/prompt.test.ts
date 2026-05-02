import { describe, it, expect } from "vitest";
import { buildPrompt, tableAliasFor } from "../../lib/ai/prompt.js";

describe("tableAliasFor", () => {
  it("sanitizes special characters and lowercases", () => {
    expect(tableAliasFor("PG-Local", "Users")).toBe("pg_local__users");
    expect(tableAliasFor("my db!", "weird table.name")).toBe("my_db__weird_table_name");
  });

  it("collapses runs of separators", () => {
    expect(tableAliasFor("a---b", "x...y")).toBe("a_b__x_y");
  });
});

describe("buildPrompt", () => {
  const baseInput = {
    nl: "show me users with the pro plan",
    connections: [
      {
        connection: "pg-local",
        plugin: "postgres",
        tables: [
          {
            table: "users",
            tableAlias: "pg_local__users",
            columns: [
              { name: "id", duckdbType: "INTEGER", nullable: false },
              { name: "email", duckdbType: "VARCHAR", nullable: false },
              { name: "plan_tier", duckdbType: "VARCHAR", nullable: true },
            ],
          },
        ],
      },
    ],
  };

  it("includes the user question, the schemas, and the JSON-shape instruction", () => {
    const built = buildPrompt(baseInput);
    expect(built.system).toContain("Output ONLY a single JSON object");
    expect(built.system).toContain("plan_english");
    expect(built.system).toContain("sources");
    expect(built.user).toContain("show me users with the pro plan");
    expect(built.user).toContain('Connection "pg-local"');
    expect(built.user).toContain("pg_local__users");
    expect(built.user).toContain("plan_tier VARCHAR NULL");
  });

  it("does not include a previous-failure block when none is given", () => {
    const built = buildPrompt(baseInput);
    expect(built.user).not.toContain("previous SQL");
    expect(built.user).not.toContain("rejected");
  });

  it("includes the previous-failure block on retry", () => {
    const built = buildPrompt({
      ...baseInput,
      previousFailure: {
        sql: "SELECT * FROM nope",
        reason: "table 'nope' is not in declared sources",
      },
    });
    expect(built.user).toContain("previous SQL was rejected");
    expect(built.user).toContain("SELECT * FROM nope");
    expect(built.user).toContain("not in declared sources");
  });

  it("flags approximate schemas inline", () => {
    const built = buildPrompt({
      ...baseInput,
      connections: [
        {
          connection: "mongo-local",
          plugin: "mongo",
          tables: [
            {
              table: "events",
              tableAlias: "mongo_local__events",
              approximate: true,
              approximateNote: "sampled 50 docs",
              columns: [{ name: "_id", duckdbType: "VARCHAR", nullable: false }],
            },
          ],
        },
      ],
    });
    expect(built.user).toContain("APPROXIMATE");
    expect(built.user).toContain("sampled 50 docs");
  });

  it("matches a stable snapshot for the canonical input", () => {
    const built = buildPrompt(baseInput);
    expect(built.user).toMatchInlineSnapshot(`
      "Question: show me users with the pro plan

      Connected sources:
      Connection "pg-local" (plugin: postgres)
        Table "users" → SQL alias: pg_local__users
          - id INTEGER NOT NULL
          - email VARCHAR NOT NULL
          - plan_tier VARCHAR NULL

      Respond with the JSON plan only."
    `);
  });
});
