/**
 * Integration test: drives the actual AI `pg_*` tools against a real PostgreSQL. The
 * headline check is that pg_run_sql's read-only guard rejects a multi-statement
 * (`;`) injection against a live server. Gated by BAKLAVA_INTEGRATION=1.
 *
 *   docker run -d --name pg -p 5432:5432 -e POSTGRES_PASSWORD=Baklava123! postgres:16
 *   BAKLAVA_INTEGRATION=1 npx vitest run src/lib/ai/tools/postgres.integration.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { reachable } from "@/test/integration-helpers";
import { pgTools } from "./postgres";
import type { AiTool } from "./types";

const cfg = {
  host: process.env.BAKLAVA_PG_HOST ?? "localhost",
  port: 5432,
  database: "postgres",
  user: process.env.BAKLAVA_PG_USER ?? "postgres",
  password: process.env.BAKLAVA_PG_PW ?? "Baklava123!",
  ssl: false,
};
const tools = pgTools("integration-conn", cfg as never);
const tool = (name: string): AiTool => tools.find((t) => t.name === name)!;

const TABLE = "integration_ai_t";

describe("postgres tools against real PostgreSQL", async () => {
  const up = await reachable("localhost", 5432);
  beforeAll(() => {
    if (!up) console.warn("[skip] postgres not reachable on localhost:5432");
  });

  it.skipIf(!up)("pg_run_sql runs a read-only SELECT", async () => {
    const res = await tool("pg_run_sql").execute({ database: "postgres", sql: "SELECT 1 AS x" });
    expect(JSON.stringify(res)).toContain("1");
  });

  it.skipIf(!up)("pg_run_sql REJECTS a multi-statement injection against the live server", async () => {
    await expect(
      tool("pg_run_sql").execute({ database: "postgres", sql: "SELECT 1; DROP TABLE IF EXISTS victim" }),
    ).rejects.toThrow(/cannot contain|terminator|;|multi/i);
    // A clean single statement with a trailing ; is allowed (guard strips it).
    const ok = await tool("pg_run_sql").execute({ database: "postgres", sql: "SELECT 42 AS y;" });
    expect(JSON.stringify(ok)).toContain("42");
  }, 20000);

  it.skipIf(!up)("create_table → list_tables → drop_table round-trip", async () => {
    // Clean slate in case a prior run left it behind.
    await tool("pg_drop_table")
      .execute({ database: "postgres", schema: "public", table: TABLE, cascade: false })
      .catch(() => {});

    await tool("pg_create_table").execute({
      database: "postgres",
      schema: "public",
      name: TABLE,
      columns: [
        { name: "id", dataType: "integer", nullable: false, isPrimaryKey: true },
        { name: "label", dataType: "text", nullable: true, isPrimaryKey: false },
      ],
    });

    const tables = await tool("pg_list_tables").execute({ database: "postgres" });
    expect(JSON.stringify(tables)).toContain(TABLE);

    await tool("pg_drop_table").execute({ database: "postgres", schema: "public", table: TABLE, cascade: false });
    const after = await tool("pg_list_tables").execute({ database: "postgres" });
    expect(JSON.stringify(after)).not.toContain(TABLE);
  }, 20000);
});
