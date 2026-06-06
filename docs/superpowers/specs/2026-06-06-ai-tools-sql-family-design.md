# AI Tools — MySQL + SQL Server (Design Spec)

- **Status:** Approved (brainstorm) — ready for implementation planning
- **Date:** 2026-06-06
- **Builds on:** the AI assistant (multi-connection chat). This is Phase 1 of
  "expand AI tools beyond Postgres + Docker".

## Summary

Add AI tool builders for **MySQL** and **SQL Server** so the assistant can
inspect and act on those connections, mirroring the existing Postgres tool set.
The gate, permission policy, conversation addressing layer, and conversation
store are all tech-agnostic and need **no changes** — this work is: two new tool
modules, two new read-only driver helpers, and two registration edits.

## Goals

- The assistant can list databases/tables, describe a table, run read-only
  analytics, create a table, and drop a table/object on MySQL and SQL Server.
- Each tool is category-tagged (`read | write | destructive`) so the existing
  per-connection permission gate enforces it unchanged.
- Ad-hoc `*_run_sql` is read-only, enforced as strongly as each engine allows.

## Non-goals (this phase)

- Mongo, Redis, Kafka, Kubernetes (Phase 2 — separate nuances).
- Row-level insert/update/delete tools, `ALTER TABLE`, or view/procedure/function
  *creation* tools. (Drop still removes views/procs/etc. on SQL Server via the
  existing `dropSqlServerObject`.)
- Any change to the gate, permissions, addressing, persistence, or UI.

---

## New driver helpers (read-only, at the driver boundary)

Defense lives in the driver (every caller inherits it), mirroring
`postgres.runReadOnlyQuery`.

### `src/lib/connections/mysql.ts` → `runReadOnlyQuery`
```ts
export async function runReadOnlyQuery(
  config: MysqlConfig, database: string, sql: string, maxRows = 1000,
): Promise<QueryResult>
```
- `const single = requireNoStatementTerminator(sql.trim().replace(/;+\s*$/g, ""), "Query")` — block embedded `;` (no multi-statement injection).
- On a fresh connection: `START TRANSACTION READ ONLY` → `conn.query(single)` → `ROLLBACK`. MySQL rejects any write inside a read-only transaction (DB-enforced, like Postgres). Cap rows at `maxRows`.
- Returns the existing `QueryResult` shape (`{ columns/fields, rows, rowCount }` — match the module's existing query-result type used by `runQueryMulti`).

### `src/lib/connections/sqlserver.ts` → `runReadOnlyQuery`
```ts
export async function runReadOnlyQuery(
  config: SqlServerConfig, database: string, sql: string, maxRows = 1000,
): Promise<{ fields: string[]; rows: unknown[][]; rowCount: number }>
```
SQL Server has **no read-only transaction mode**, so enforce in layers:
1. `requireNoStatementTerminator(sql.trim().replace(/;+\s*$/g, ""), "Query")` — single statement only.
2. **Write-keyword denylist** (defense-in-depth): reject if the statement matches, case-insensitively, a word-boundary pattern over `insert, update, delete, merge, drop, create, alter, truncate, exec, execute, grant, revoke, into, sp_, xp_`. Throw a clear "read-only: writes are not allowed" error.
3. **Rollback wrap** (the DB-level backstop): run the single statement inside `BEGIN TRAN … ROLLBACK` (via `pool.request().batch("BEGIN TRAN; " + single + "; ROLLBACK")` — the server-controlled `;` separators are safe because `single` contains none). Anything that slips past the denylist still never persists.
- Read the recordset, cap at `maxRows`, return `{ fields, rows, rowCount }`.

Both helpers run their guards **before** opening the connection/pool, so they're unit-testable without a live database (same as the Postgres read-only test).

---

## Tool catalogs

Each builder has the signature `(_connectionId: string, config: <Cfg>) => AiTool[]`
and wraps existing driver functions. Args use the real shape per engine.

### MySQL — `src/lib/ai/tools/mysql.ts` (args: `{ database, table }`, no schema layer)

| Tool | Category | Wraps |
|------|----------|-------|
| `mysql_list_databases` | read | `listDatabases` |
| `mysql_list_tables` | read | `listTables(config, database)` |
| `mysql_describe_table` | read | `listColumns` + `getTableDDL` |
| `mysql_run_sql` | read | new `runReadOnlyQuery` (cap 1000) |
| `mysql_create_table` | write | `createTable` (structured columns[]) |
| `mysql_drop_table` | destructive | `dropTable` |

### SQL Server — `src/lib/ai/tools/sqlserver.ts` (args: `{ database, schema, table }`)

| Tool | Category | Wraps |
|------|----------|-------|
| `mssql_list_databases` | read | `listSqlServerDatabases` |
| `mssql_list_objects` | read | `listSqlServerObjects(config, database)` |
| `mssql_describe_table` | read | `getSqlServerTableDetail` |
| `mssql_run_sql` | read | new `runReadOnlyQuery` (rollback-wrapped) |
| `mssql_create_table` | write | `createSqlServerTable` |
| `mssql_drop_object` | destructive | `dropSqlServerObject` ({schema, name, kind}) |

`mysql_create_table` / `mssql_create_table` reuse the drivers' existing
`CreateTableColumnInput` shapes; the zod `inputSchema` mirrors `pg_create_table`'s
columns array. `mssql_drop_object` takes `kind` (table/view/proc/…) which the
existing `dropSqlServerObject` already supports.

## Wiring

- `src/lib/ai/tools/registry.ts` — add to `BUILDERS`:
  `mysql: (id, cfg) => mysqlTools(id, cfg as never)`,
  `sqlserver: (id, cfg) => mssqlTools(id, cfg as never)`.
- `src/lib/ai/supported.ts` — `AI_SUPPORTED_TECHS = ["postgres", "docker", "mysql", "sqlserver"]`.

The `/` connection picker, model picker, working-set chips, per-connection policy
gate, approval cards, and audit log then cover MySQL + SQL Server automatically.

## Safety

- Unchanged per-connection model: every tool runs through the existing
  `wrapExecute` gate with that connection's policy + approval + audit.
- Identifiers go through each driver's existing `validateIdentifier` / bracket-or-
  backtick quoting; create/drop reuse the drivers' guarded builders.
- The only new safety surface is the two read-only helpers (above): MySQL is
  DB-enforced read-only; SQL Server is single-statement + keyword-denylist +
  rollback-wrapped.
- The merged-tool `connection` enum already prevents addressing a connection
  outside the working set or one whose policy forbids the category.

## Testing

- **Unit (`tools/mysql.test.ts`, `tools/sqlserver.test.ts`):** vi.mock the driver
  module; assert category tags and that each tool's `execute` delegates to the
  right driver fn with the right args (mirrors `tools/postgres.test.ts`).
- **Unit (read-only guards):** call `mysql.runReadOnlyQuery` / `sqlserver.runReadOnlyQuery`
  with a bogus/unreachable config and assert: multi-statement (`;`) is rejected,
  and (SQL Server) a write-keyword statement is rejected — both **before** any
  connection attempt (guards run first). A clean single `SELECT` passes the guard
  and then fails with a *connection* error, proving it was let through.
- **Unit (`tools/registry.test.ts`):** `buildTools("mysql", …)` and
  `buildTools("sqlserver", …)` return the expected tool names; default policy
  exposes only the read tools.
- Driver `runReadOnlyQuery` DB behavior (actual read-only rejection) is covered by
  the integration harness, per repo convention; not unit-tested against a live DB.

## Open items

- None. (OpenAI/Google model-id verification and Phase 2 techs are tracked
  separately.)
