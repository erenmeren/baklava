# AI Tools — MySQL + SQL Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI assistant inspect and act on MySQL + SQL Server connections via category-tagged tools mirroring the existing Postgres set.

**Architecture:** Two new driver read-only helpers (`runReadOnlyQuery` in `mysql.ts` and `sqlserver.ts`), two new tool modules (`tools/mysql.ts`, `tools/sqlserver.ts`) of thin wrappers over existing driver functions, and two registration edits. The gate, permission policy, addressing layer, persistence, and UI are tech-agnostic and unchanged.

**Tech Stack:** TypeScript, Vitest, `mysql2`, `mssql`, `zod`, AI SDK tool shape. Reuses `src/lib/ai/tools/types.ts` (`AiTool`), `registry.ts`, `supported.ts`.

**Spec:** `docs/superpowers/specs/2026-06-06-ai-tools-sql-family-design.md`
**Branch:** continue on `feat/ai-tools-sql-family`.

---

## File Structure

- **Modify:** `src/lib/connections/mysql.ts` (add `runReadOnlyQuery`), `src/lib/connections/sqlserver.ts` (add `runReadOnlyQuery`), `src/lib/ai/tools/registry.ts` (BUILDERS), `src/lib/ai/supported.ts` (AI_SUPPORTED_TECHS).
- **Create:** `src/lib/ai/tools/mysql.ts`, `src/lib/ai/tools/sqlserver.ts`, and tests `src/lib/connections/mysql-readonly.test.ts`, `src/lib/connections/sqlserver-readonly.test.ts`, `src/lib/ai/tools/mysql.test.ts`, `src/lib/ai/tools/sqlserver.test.ts`.

---

## Task 1: MySQL read-only query helper

**Files:** Modify `src/lib/connections/mysql.ts`; Test `src/lib/connections/mysql-readonly.test.ts`.

Existing in `mysql.ts`: private `withConn(config, database, fn, opts?)`, exported `requireNoStatementTerminator(value, fieldName)` (throws `"<field> must not contain \";\"."`), `MysqlConfig` type import.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connections/mysql-readonly.test.ts
import { describe, it, expect } from "vitest";
import { runReadOnlyQuery } from "./mysql";

const cfg = { host: "203.0.113.1", port: 1, database: "x", user: "u", password: "p", ssl: false };

describe("mysql runReadOnlyQuery guards", () => {
  it("rejects multi-statement injection before connecting", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "COMMIT; INSERT INTO t VALUES (1)")).rejects.toThrow(/must not contain/i);
  });
  it("lets a clean single statement through the guard (then fails to connect)", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "SELECT 1;")).rejects.not.toThrow(/must not contain/i);
  }, 20000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/connections/mysql-readonly.test.ts`
Expected: FAIL — `runReadOnlyQuery` is not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/connections/mysql.ts` (after the `runQueryMulti` function). Use the existing private `withConn`. Return a read-tool-friendly shape (arrays, like the Postgres read tool):
```ts
export interface ReadOnlyResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

/**
 * Run a single read-only statement enforced by MySQL's READ ONLY transaction.
 * Blocks ';' (no multi-statement injection); writes are rejected by the engine
 * inside `START TRANSACTION READ ONLY`. Used by the AI `mysql_run_sql` tool.
 */
export async function runReadOnlyQuery(
  config: MysqlConfig,
  database: string,
  sql: string,
  maxRows = 1000,
): Promise<ReadOnlyResult> {
  const single = requireNoStatementTerminator(sql.trim().replace(/;+\s*$/g, ""), "Query");
  return withConn(config, database, async (conn) => {
    const start = Date.now();
    await conn.query("START TRANSACTION READ ONLY");
    try {
      const [rows, fields] = (await conn.query({ sql: single, rowsAsArray: true })) as unknown as [
        unknown[][],
        { name: string }[],
      ];
      const capped = (rows ?? []).slice(0, maxRows);
      return {
        fields: (fields ?? []).map((f) => f.name),
        rows: capped,
        rowCount: capped.length,
        durationMs: Date.now() - start,
      };
    } finally {
      await conn.query("ROLLBACK").catch(() => undefined);
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/connections/mysql-readonly.test.ts`
Expected: PASS (2 tests). The second rejects with a connection error (ECONN/timeout), not the terminator error.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expect PASS.
```bash
git add src/lib/connections/mysql.ts src/lib/connections/mysql-readonly.test.ts
git commit -m "feat(mysql): runReadOnlyQuery — DB-enforced read-only for AI"
```

---

## Task 2: SQL Server read-only query helper

**Files:** Modify `src/lib/connections/sqlserver.ts`; Test `src/lib/connections/sqlserver-readonly.test.ts`.

Existing in `sqlserver.ts`: private `withPool(config, fn, opts?: { database?, requestTimeoutMs? })`, exported `requireNoStatementTerminator(value, fieldName)` (throws `"<field> cannot contain ';'"`).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connections/sqlserver-readonly.test.ts
import { describe, it, expect } from "vitest";
import { runReadOnlyQuery } from "./sqlserver";

const cfg = { host: "203.0.113.1", port: 1, database: "x", user: "u", password: "p", encrypt: false, trustServerCertificate: true };

describe("sqlserver runReadOnlyQuery guards", () => {
  it("rejects multi-statement injection before connecting", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "SELECT 1; DROP TABLE t")).rejects.toThrow(/cannot contain/i);
  });
  it("rejects a write-keyword statement before connecting", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "DELETE FROM t")).rejects.toThrow(/read-only/i);
    await expect(runReadOnlyQuery(cfg, "x", "UPDATE t SET a=1")).rejects.toThrow(/read-only/i);
    await expect(runReadOnlyQuery(cfg, "x", "SELECT * INTO t2 FROM t")).rejects.toThrow(/read-only/i);
  });
  it("lets a clean SELECT through the guards (then fails to connect)", async () => {
    await expect(runReadOnlyQuery(cfg, "x", "SELECT 1")).rejects.not.toThrow(/cannot contain|read-only/i);
  }, 20000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/connections/sqlserver-readonly.test.ts`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `src/lib/connections/sqlserver.ts` (after `runSqlServerScript`). SQL Server has no read-only transaction, so: single-statement + write-keyword denylist + rollback-wrap.
```ts
export interface ReadOnlyResult {
  fields: string[];
  rows: unknown[][];
  rowCount: number;
}

// Defense-in-depth denylist for the read-only AI query path. The rollback wrap
// below is the real backstop; this just rejects obvious writes early. `_` is a
// word char so this won't trip on column names like `update_time`.
const WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|drop|create|alter|truncate|exec|execute|grant|revoke|into|sp_|xp_)\b/i;

/**
 * Run a single read-only statement. SQL Server has no READ ONLY transaction, so
 * we (1) block ';' (single statement), (2) reject write keywords, and (3) wrap in
 * BEGIN TRAN … ROLLBACK so anything that slips past still never persists.
 */
export async function runReadOnlyQuery(
  config: SqlServerConfig,
  database: string,
  sql: string,
  maxRows = 1000,
): Promise<ReadOnlyResult> {
  const single = requireNoStatementTerminator(sql.trim().replace(/;+\s*$/g, ""), "Query");
  const m = single.match(WRITE_KEYWORDS);
  if (m) {
    throw new Error(`Read-only query rejected: contains a write keyword ("${m[0]}").`);
  }
  return withPool(
    config,
    async (pool) => {
      const res = await pool.request().batch(`BEGIN TRAN;\n${single};\nROLLBACK;`);
      const rs = (res.recordset ?? []) as unknown as Array<Record<string, unknown>> & {
        columns?: Record<string, unknown>;
      };
      const fields = rs.columns ? Object.keys(rs.columns) : rs[0] ? Object.keys(rs[0]) : [];
      const capped = rs.slice(0, maxRows);
      return {
        fields,
        rows: capped.map((row) => fields.map((f) => row[f] ?? null)),
        rowCount: capped.length,
      };
    },
    { database },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/connections/sqlserver-readonly.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expect PASS.
```bash
git add src/lib/connections/sqlserver.ts src/lib/connections/sqlserver-readonly.test.ts
git commit -m "feat(mssql): runReadOnlyQuery — single-statement + denylist + rollback wrap"
```

---

## Task 3: MySQL tools

**Files:** Create `src/lib/ai/tools/mysql.ts`; Test `src/lib/ai/tools/mysql.test.ts`.

Driver fns: `listDatabases(config)`, `listTables(config, database)`, `listColumns(config, database, table)`, `getTableDDL(config, database, table)`, `runReadOnlyQuery(config, database, sql, maxRows)`, `createTable(config, database, input: CreateTableInput)` (`CreateTableColumnInput { name, type, nullable, default?, autoIncrement?, primaryKey? }`), `dropTable(config, database, table, kind?)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/tools/mysql.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/mysql", () => ({
  listDatabases: vi.fn(async () => [{ name: "app" }]),
  listTables: vi.fn(async () => [{ name: "orders", kind: "table" }]),
  listColumns: vi.fn(async () => [{ name: "id" }]),
  getTableDDL: vi.fn(async () => "CREATE TABLE ..."),
  runReadOnlyQuery: vi.fn(async () => ({ fields: ["n"], rows: [[1]], rowCount: 1, durationMs: 1 })),
  createTable: vi.fn(async () => undefined),
  dropTable: vi.fn(async () => undefined),
}));

import * as my from "@/lib/connections/mysql";
import { mysqlTools } from "./mysql";

const cfg = { host: "h", port: 3306, database: "app", user: "u", password: "p", ssl: false };

describe("mysqlTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags categories", () => {
    const byName = Object.fromEntries(mysqlTools("c1", cfg).map((t) => [t.name, t.category]));
    expect(byName["mysql_run_sql"]).toBe("read");
    expect(byName["mysql_list_tables"]).toBe("read");
    expect(byName["mysql_create_table"]).toBe("write");
    expect(byName["mysql_drop_table"]).toBe("destructive");
  });

  it("mysql_run_sql delegates to runReadOnlyQuery", async () => {
    const t = mysqlTools("c1", cfg).find((x) => x.name === "mysql_run_sql")!;
    await t.execute({ database: "app", sql: "select 1" });
    expect(my.runReadOnlyQuery).toHaveBeenCalledWith(cfg, "app", "select 1", 1000);
  });

  it("mysql_drop_table delegates to dropTable", async () => {
    const t = mysqlTools("c1", cfg).find((x) => x.name === "mysql_drop_table")!;
    await t.execute({ database: "app", table: "orders" });
    expect(my.dropTable).toHaveBeenCalledWith(cfg, "app", "orders");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/tools/mysql.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/ai/tools/mysql.ts
import { z } from "zod";
import type { MysqlConfig } from "@/lib/connections/types";
import {
  listDatabases,
  listTables,
  listColumns,
  getTableDDL,
  runReadOnlyQuery,
  createTable,
  dropTable,
  type CreateTableColumnInput,
} from "@/lib/connections/mysql";
import type { AiTool } from "./types";

const READ_SQL_MAX_ROWS = 1000;

export function mysqlTools(_connectionId: string, config: MysqlConfig): AiTool[] {
  return [
    {
      name: "mysql_list_databases",
      description: "List databases on this MySQL server.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listDatabases(config),
    },
    {
      name: "mysql_list_tables",
      description: "List tables and views in a database.",
      category: "read",
      inputSchema: z.object({ database: z.string() }),
      execute: async ({ database }) => listTables(config, database as string),
    },
    {
      name: "mysql_describe_table",
      description: "Get a table's columns and its CREATE TABLE DDL.",
      category: "read",
      inputSchema: z.object({ database: z.string(), table: z.string() }),
      execute: async ({ database, table }) => ({
        columns: await listColumns(config, database as string, table as string),
        ddl: await getTableDDL(config, database as string, table as string),
      }),
    },
    {
      name: "mysql_run_sql",
      description:
        "Run a READ-ONLY SQL query (SELECT / analytics) and return rows. Writes are rejected by the database. Use this for calculations and data exploration.",
      category: "read",
      inputSchema: z.object({ database: z.string(), sql: z.string() }),
      execute: async ({ database, sql }) =>
        runReadOnlyQuery(config, database as string, sql as string, READ_SQL_MAX_ROWS),
    },
    {
      name: "mysql_create_table",
      description: "Create a new table with the given columns.",
      category: "write",
      inputSchema: z.object({
        database: z.string(),
        name: z.string(),
        columns: z
          .array(
            z.object({
              name: z.string(),
              type: z.string(),
              nullable: z.boolean().default(true),
              primaryKey: z.boolean().default(false),
              autoIncrement: z.boolean().default(false),
              default: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ database, name, columns }) => {
        await createTable(config, database as string, {
          name: name as string,
          columns: columns as CreateTableColumnInput[],
        });
        return { ok: true, created: `${database}.${name}` };
      },
    },
    {
      name: "mysql_drop_table",
      description: "Drop (delete) a table. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({ database: z.string(), table: z.string() }),
      execute: async ({ database, table }) => {
        await dropTable(config, database as string, table as string);
        return { ok: true, dropped: `${database}.${table}` };
      },
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/ai/tools/mysql.test.ts`
Expected: PASS (3 tests). (The zod `.default()` fields aren't read by execute directly, so no fallback needed here.)

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expect PASS.
```bash
git add src/lib/ai/tools/mysql.ts src/lib/ai/tools/mysql.test.ts
git commit -m "feat(ai): mysql tools (read/write/destructive)"
```

---

## Task 4: SQL Server tools

**Files:** Create `src/lib/ai/tools/sqlserver.ts`; Test `src/lib/ai/tools/sqlserver.test.ts`.

Driver fns: `listSqlServerDatabases(config)`, `listSqlServerObjects(config, database)`, `getSqlServerTableDetail(config, database, schema, table)`, `runReadOnlyQuery(config, database, sql, maxRows)`, `createSqlServerTable(config, database, input: CreateSqlServerTableInput)` (`CreateSqlServerColumnInput { name, dataType, nullable, default?, isPrimaryKey, identity }`), `dropSqlServerObject(config, database, { schema, name, kind })`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/ai/tools/sqlserver.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/sqlserver", () => ({
  listSqlServerDatabases: vi.fn(async () => [{ name: "app" }]),
  listSqlServerObjects: vi.fn(async () => [{ schema: "dbo", name: "Orders", kind: "table" }]),
  getSqlServerTableDetail: vi.fn(async () => ({ columns: [], indexes: [] })),
  runReadOnlyQuery: vi.fn(async () => ({ fields: ["n"], rows: [[1]], rowCount: 1 })),
  createSqlServerTable: vi.fn(async () => undefined),
  dropSqlServerObject: vi.fn(async () => undefined),
}));

import * as ms from "@/lib/connections/sqlserver";
import { mssqlTools } from "./sqlserver";

const cfg = { host: "h", port: 1433, database: "app", user: "u", password: "p", encrypt: false, trustServerCertificate: true };

describe("mssqlTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags categories", () => {
    const byName = Object.fromEntries(mssqlTools("c1", cfg).map((t) => [t.name, t.category]));
    expect(byName["mssql_run_sql"]).toBe("read");
    expect(byName["mssql_list_objects"]).toBe("read");
    expect(byName["mssql_create_table"]).toBe("write");
    expect(byName["mssql_drop_object"]).toBe("destructive");
  });

  it("mssql_run_sql delegates to runReadOnlyQuery", async () => {
    const t = mssqlTools("c1", cfg).find((x) => x.name === "mssql_run_sql")!;
    await t.execute({ database: "app", sql: "select 1" });
    expect(ms.runReadOnlyQuery).toHaveBeenCalledWith(cfg, "app", "select 1", 1000);
  });

  it("mssql_drop_object delegates to dropSqlServerObject", async () => {
    const t = mssqlTools("c1", cfg).find((x) => x.name === "mssql_drop_object")!;
    await t.execute({ database: "app", schema: "dbo", name: "Orders", kind: "table" });
    expect(ms.dropSqlServerObject).toHaveBeenCalledWith(cfg, "app", { schema: "dbo", name: "Orders", kind: "table" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/ai/tools/sqlserver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/ai/tools/sqlserver.ts
import { z } from "zod";
import type { SqlServerConfig } from "@/lib/connections/types";
import {
  listSqlServerDatabases,
  listSqlServerObjects,
  getSqlServerTableDetail,
  runReadOnlyQuery,
  createSqlServerTable,
  dropSqlServerObject,
  type CreateSqlServerColumnInput,
} from "@/lib/connections/sqlserver";
import type { AiTool } from "./types";

const READ_SQL_MAX_ROWS = 1000;

export function mssqlTools(_connectionId: string, config: SqlServerConfig): AiTool[] {
  return [
    {
      name: "mssql_list_databases",
      description: "List databases on this SQL Server instance.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listSqlServerDatabases(config),
    },
    {
      name: "mssql_list_objects",
      description: "List tables, views, procedures and functions in a database.",
      category: "read",
      inputSchema: z.object({ database: z.string() }),
      execute: async ({ database }) => listSqlServerObjects(config, database as string),
    },
    {
      name: "mssql_describe_table",
      description: "Get a table's columns, indexes, constraints and foreign keys.",
      category: "read",
      inputSchema: z.object({ database: z.string(), schema: z.string().default("dbo"), table: z.string() }),
      execute: async ({ database, schema, table }) =>
        getSqlServerTableDetail(config, database as string, (schema as string) ?? "dbo", table as string),
    },
    {
      name: "mssql_run_sql",
      description:
        "Run a READ-ONLY SQL query (SELECT / analytics) and return rows. Writes are rejected and rolled back. Use this for calculations and data exploration.",
      category: "read",
      inputSchema: z.object({ database: z.string(), sql: z.string() }),
      execute: async ({ database, sql }) =>
        runReadOnlyQuery(config, database as string, sql as string, READ_SQL_MAX_ROWS),
    },
    {
      name: "mssql_create_table",
      description: "Create a new table with the given columns.",
      category: "write",
      inputSchema: z.object({
        database: z.string(),
        schema: z.string().default("dbo"),
        name: z.string(),
        columns: z
          .array(
            z.object({
              name: z.string(),
              dataType: z.string(),
              nullable: z.boolean().default(true),
              isPrimaryKey: z.boolean().default(false),
              identity: z.boolean().default(false),
              default: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ database, schema, name, columns }) => {
        await createSqlServerTable(config, database as string, {
          schema: ((schema as string) ?? "dbo") || "dbo",
          name: name as string,
          columns: columns as CreateSqlServerColumnInput[],
        });
        return { ok: true, created: `${schema ?? "dbo"}.${name}` };
      },
    },
    {
      name: "mssql_drop_object",
      description: "Drop (delete) a table, view, procedure or function. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({
        database: z.string(),
        schema: z.string().default("dbo"),
        name: z.string(),
        kind: z.enum(["table", "view", "proc", "scalar_fn", "table_fn", "trigger", "synonym", "sequence", "type"]).default("table"),
      }),
      execute: async ({ database, schema, name, kind }) => {
        await dropSqlServerObject(config, database as string, {
          schema: ((schema as string) ?? "dbo") || "dbo",
          name: name as string,
          kind: (kind as string) ?? "table",
        });
        return { ok: true, dropped: `${schema ?? "dbo"}.${name}` };
      },
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/ai/tools/sqlserver.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expect PASS.
```bash
git add src/lib/ai/tools/sqlserver.ts src/lib/ai/tools/sqlserver.test.ts
git commit -m "feat(ai): sqlserver tools (read/write/destructive)"
```

---

## Task 5: Register the techs

**Files:** Modify `src/lib/ai/supported.ts`, `src/lib/ai/tools/registry.ts`; Test update `src/lib/ai/tools/registry.test.ts`.

- [ ] **Step 1: Extend the supported list**

In `src/lib/ai/supported.ts`, change `AI_SUPPORTED_TECHS` to:
```ts
export const AI_SUPPORTED_TECHS: TechId[] = ["postgres", "docker", "mysql", "sqlserver"];
```

- [ ] **Step 2: Register the builders**

In `src/lib/ai/tools/registry.ts`, import the new builders and add to `BUILDERS`:
```ts
import { mysqlTools } from "./mysql";
import { mssqlTools } from "./sqlserver";
// …in the BUILDERS object, alongside postgres + docker:
  mysql: (id, cfg) => mysqlTools(id, cfg as never),
  sqlserver: (id, cfg) => mssqlTools(id, cfg as never),
```

- [ ] **Step 3: Add a registry test for the new techs**

Append to `src/lib/ai/tools/registry.test.ts`:
```ts
import { DEFAULT_POLICY } from "../permissions";

const myCfg = { host: "h", port: 3306, database: "app", user: "u", password: "p", ssl: false };
const msCfg = { host: "h", port: 1433, database: "app", user: "u", password: "p", encrypt: false, trustServerCertificate: true };

describe("buildTools — sql family", () => {
  it("exposes mysql read tools under default policy", () => {
    const names = buildTools("mysql", "c1", myCfg, DEFAULT_POLICY).map((t) => t.name);
    expect(names).toContain("mysql_run_sql");
    expect(names).not.toContain("mysql_drop_table");
  });
  it("exposes sqlserver read tools under default policy", () => {
    const names = buildTools("sqlserver", "c1", msCfg, DEFAULT_POLICY).map((t) => t.name);
    expect(names).toContain("mssql_run_sql");
    expect(names).not.toContain("mssql_drop_object");
  });
});
```
(If `buildTools` / `DEFAULT_POLICY` imports already exist at the top of the test file, don't duplicate the `DEFAULT_POLICY` import — add the `describe` block and the two cfg consts only.)

- [ ] **Step 4: Verify**

Run: `npm test -- src/lib/ai/tools/registry.test.ts` — expect PASS.
Run: `npm run typecheck && npm run lint` — expect PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/ai/supported.ts src/lib/ai/tools/registry.ts src/lib/ai/tools/registry.test.ts
git commit -m "feat(ai): register mysql + sqlserver tools (AI-supported techs)"
```

---

## Task 6: Full verification

**Files:** none.

- [ ] **Step 1: Full gate** — `npm test && npm run typecheck && npm run lint && npm run build` — all green; `/assistant` builds.
- [ ] **Step 2: Manual (needs a key + live MySQL/SQL Server)** — `npm run dev` → `/assistant`. Type `/` → a MySQL and a SQL Server connection now appear in the picker. Add one; ask "how many rows are in &lt;table&gt;?" → expect a `mysql_run_sql` / `mssql_run_sql` read with an answer, no approval card. Ask it to "insert a row" → it has no write tool (default policy) and explains it can't; confirm a sneaked `INSERT` via run_sql is rejected (MySQL: read-only txn; SQL Server: denylist/rollback).
- [ ] **Step 3: Manual write/destructive** — enable write+destructive on the connection's chip popover; ask to create then drop a throwaway table → each shows an approval card naming the connection; approve and verify.
- [ ] **Step 4: Commit checkpoint**
```bash
git commit --allow-empty -m "chore(ai): mysql + sqlserver tools verified"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** mysql read-only helper (Task 1) · mssql read-only helper w/ denylist + rollback (Task 2) · mysql tool catalog (Task 3) · sqlserver tool catalog (Task 4) · registry + supported wiring (Task 5) · safety reuse via gate (unchanged) · tests incl. guard-before-connect (Tasks 1–2) and category/delegation (3–4) and registry (5). All spec sections map to a task.
- **Placeholder scan:** every code step is concrete; the SQL Server write denylist is a real regex; no TBDs.
- **Type consistency:** `runReadOnlyQuery` signature `(config, db, sql, maxRows)` identical in both drivers and called identically by both tools (`…, 1000`); `ReadOnlyResult` defined per driver; `CreateTableColumnInput` (mysql) and `CreateSqlServerColumnInput` (mssql) used exactly as the drivers declare; `dropTable(config, db, table)` and `dropSqlServerObject(config, db, {schema,name,kind})` match the real signatures grepped from the drivers; `mysqlTools`/`mssqlTools` names match the registry imports.
- **Note:** `mysql_run_sql` returns row arrays (`rowsAsArray`), `mssql_run_sql` maps recordset objects to arrays — both `{ fields, rows, rowCount }`, consistent for the model to read.
