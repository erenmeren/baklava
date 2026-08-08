# SQL Driver & Workspace Refactor — Design

**Date:** 2026-08-08
**Status:** Approved (design); ready for implementation planning

## Problem

Two related accumulations of duplication, both in the SQL family
(postgres / mysql / sqlserver).

**Driver monoliths.** `src/lib/connections/postgres.ts` is 3689 lines with 72
exported functions; `sqlserver.ts` is 2947 lines with 48. Neither fits in a
reviewer's head or an agent's working context. They are imported from 39 and 35
call sites respectively.

**Parallel workspace UIs.** Six file families are copy-adapted across the three
SQL techs, ~14K lines total:

| family | postgres | mysql | sqlserver |
|---|---:|---:|---:|
| `table-detail-client.tsx` | 1637 | 1190 | 604 |
| `query-editor-client.tsx` | 1086 | 1273 | 734 |
| `overview-client.tsx` | 1315 | 588 | 1081 |
| `*-tabs.tsx` | 477 | 420 | 422 |
| `row-form-dialog.tsx` | 378 | 436 | 403 |
| `create-table-dialog.tsx` | 407 | 412 | 426 |

The duplication is documented in the source itself.
`sqlserver/…/row-form-dialog.tsx` opens with: *"SQL Server flavor of the row
form. Same shape as the Postgres one … but tinted rose."*

The copies have since diverged on semantics, not just naming — Postgres carries
schemas and `CASCADE`, MySQL has no schema layer but adds `TRUNCATE` and
table/view kinds, SQL Server has its own. So a bug fixed in one grid is not
fixed in the other two, and a 13th SQL technology means copying six families
again.

**No safety net.** `src/app/{postgres,mysql,sqlserver}` contains **zero**
component tests, and the Playwright suite covers auth, RBAC, home, theme,
docker-logs and the assistant — but none of the SQL workspaces.

## Goals

All four of these, in priority order:

1. **Adding a SQL technology gets cheap** — configure a shared core instead of
   copying six file families.
2. **Bugs get fixed once** — a grid/pagination defect is repaired in one place.
3. **Files become readable** — no client component near 1600 lines.
4. **Total LOC drops.**

## Non-goals / accepted trade-offs

- **This is not a pure refactor.** L3 (below) deliberately converges behaviour:
  SQL Server gains per-row edit/delete, MySQL gains Constraints and Foreign
  keys tabs. That is new behaviour and it is intended — a shared component that
  is capability-gated down to each tech's current feature set would bloat the
  config surface and forfeit most of the LOC win.
- **`sqlserver.ts`'s naming stays untouched in L0.** Its 39 exports carry an
  `xxxSqlServer` prefix (`insertSqlServerRow`) where postgres and mysql use bare
  names (`insertRow`). Normalising this is mechanical, but it would inflate the
  L0 diff and mix two concerns. L0 is pure file movement, provable by
  `tsc --noEmit`; renaming is an optional follow-up.
- **The three fetch strategies are preserved, not unified.** Postgres fetches
  lazily per tab via `?view=`; MySQL and SQL Server each fetch one payload
  up front. This is a real difference driven by each server's catalog cost, so
  the design isolates it in an adapter rather than forcing one strategy.
- **`overview-client` and `create-table-dialog` convergence is bounded.** These
  surface genuinely tech-specific content (Postgres bloat/vacuum stats, SQL
  Server wait buckets, MySQL engine/collation). They share primitives (L1) but
  do not get a common shell (L2).

## Prerequisite: the SSE parser straggler

An earlier survey overcounted SSE duplication. Ten client files use the
browser's native `EventSource`, which parses frames itself — no duplication
there. Exactly one file hand-rolls frame parsing:
`src/app/assistant/assistant-client.tsx:316` splits on `\n\n` instead of using
`SseFrameParser` from `src/lib/sse-client.ts`.

This is a ~15-line fix, unrelated to the rest of the design, and ships first
because it is free.

## Architecture

The work is four layers, bottom-up. Each is independently shippable and
independently verifiable.

### L0 — Driver split

`postgres.ts` becomes a directory plus a barrel. The seams already exist in the
file's export order:

| module | contents | ~LOC |
|---|---|---:|
| `postgres/client.ts` | pool cache, `withClient`, `dropPostgresPools`, test hooks, `probePostgres` | 130 |
| `postgres/sql.ts` | `quoteIdent`, `validateIdentifier`, `requireNoStatementTerminator`, `splitSqlStatements` | 90 |
| `postgres/catalog.ts` | `list{Databases,Schemas,SchemasWithStats,Objects,AllRelations,Columns,SchemaColumns,Indexes,Constraints,ForeignKeys,Functions,Sequences}`, `getTableStats`, `getTableDDL`, `getViewDefinition`, `getFunctionDefinition` | 820 |
| `postgres/rows.ts` | `readTableData`, `insertRow`, `updateRow`, `deleteRow`, `ColumnValue`, `PrimaryKeyValue` | 240 |
| `postgres/ddl.ts` | `createTable`, `alterTable`, `dropTable`, `dropView`, schema/database create+drop, index create/drop/rename, sequence + function + view + extension ops | 760 |
| `postgres/query.ts` | `runQuery`, `runReadOnlyQuery`, `runQueryMulti`, `explainQuery`, EXPLAIN types | 520 |
| `postgres/ops.ts` | `getServerOverview`, `getTopTables*`, `listActivity`, `cancel/terminateBackend`, `listBlockingTree`, `runMaintenance`, `reindexTable`, `getOverviewExtras`, `getDiagnostics`, role CRUD | 1000 |
| `postgres/backup.ts` | `streamDatabaseDump`, `restoreSql` | 230 |

Line counts are approximate and sum slightly above 3689 because each module
repeats its own imports and shared type declarations.

`sqlserver.ts` maps onto the same eight boxes.

`src/lib/connections/postgres.ts` and `sqlserver.ts` survive as barrels
(`export * from "./postgres/client"`, …). **All 74 import sites stay
byte-identical.** Export names do not change.

The SQL-safety rules in AGENTS.md continue to hold: `quoteIdent` /
`validateIdentifier` / `requireNoStatementTerminator` move into
`<tech>/sql.ts` and every DDL module imports from there, so there is still one
place that decides how identifiers are quoted.

`dropPostgresPools` stays reachable from the `DELETE /api/connections/[id]`
cascade through the barrel — the cascade contract is unchanged.

### Safety net (before L1)

L0 is provable by the type checker. L1 and L2 are not, and there is currently
nothing to regress against. So before any UI file is touched:

- **Component tests** (`*.dom.test.tsx`, `client` vitest project, happy-dom) for
  the three `table-detail-client`s and three `query-editor-client`s. Each
  asserts: the rendered tab set, grid rows and column headers, pagination
  controls, the density toggle, presence/absence of CRUD affordances, and the
  error state. `src/test/factories.ts` supplies fixtures.
- **Playwright smoke** — one spec per SQL tech: open a connection, reach a
  table, visit each tab, confirm content renders.

These tests must pass **unchanged** through L1 and L2. Any edit to them during
those layers is a regression that needs justifying, not a test that needs
updating. L3 changes them deliberately, because L3 changes behaviour.

### L1 — Shared primitives

The shared layer already exists — `src/components/workspace/`, whose
`dialog-shell.tsx` has 13 consumers. This grows it rather than inventing a new
home:

- `DataGrid` — rows, column headers, cell formatting, density toggle,
  pagination, copy-cell. Absorbs the duplicated `fmtCell` / `formatBytes` /
  `formatNumber` / `Chip` helpers.
- `StructurePanel` — the columns table (all three have a private copy).
- `IndexesPanel`, `DdlPanel`.
- `RowFormDialog` — one implementation with a `tint` prop and a pluggable
  type-detection function, replacing three copies. Retains per-tech behaviour
  that matters: SQL Server IDENTITY columns locked out of insert, Postgres
  `DEFAULT` toggle, MySQL enum handling.
- `useTableTabs` — the localStorage-backed tab-strip state shared by
  `postgres-tabs` / `mysql-tabs` / `sqlserver-tabs` / `mongo-tabs`, including
  the middle-click-to-close contract and the `fetched`-flag stale-tab pruner
  documented in AGENTS.md.

Each tech's client keeps its own data flow and imports these.

### L2 — Shared shell

`<SqlTableDetail descriptor={…}>` in `src/components/workspace/sql/`.

The descriptor absorbs the real divergence instead of pretending it away:

```ts
interface SqlTableDetailDescriptor<TDetail, TCtx> {
  tech: TechId;
  tabs: TableTab[]; // data | structure | indexes | constraints | foreign_keys | ddl | stats
  capabilities: {
    insertRow: boolean;
    editRow: boolean;
    deleteRow: boolean;
    truncate: boolean;
    dropTable: boolean;
    createIndex: boolean;
    dropIndex: boolean;
    renameIndex: boolean;
  };
  paths: { base(ctx: TCtx): string; rows(ctx: TCtx): string };
  load:
    | { strategy: "per-tab"; fetchTab(tab: TableTab, ctx: TCtx, signal: AbortSignal): Promise<unknown> }
    | { strategy: "single"; fetchAll(ctx: TCtx, signal: AbortSignal): Promise<TDetail> };
  /** Escape hatch for panels only one tech has (e.g. Postgres statistics). */
  render?: Partial<Record<TableTab, (data: unknown) => React.ReactNode>>;
}
```

`load` is the load-bearing part of this design. Postgres uses `per-tab`, MySQL
and SQL Server use `single`; the shell owns tab state, abort handling, error
surfaces and refresh-after-mutation regardless of which.

Each tech's `table-detail-client.tsx` shrinks to a descriptor plus its fetch
adapter. `query-editor-client` gets the same treatment in a second pass, sharing
the CodeMirror setup, result grid, statement splitter wiring and history strip.

The `render` escape hatch is deliberate. Postgres's `StatsGrid` and SQL Server's
client-side `buildClientDdl` are genuinely one-tech panels; forcing them into
the common shell is how config surfaces metastasise.

### L3 — Convergence

- **SQL Server per-row edit/delete.** `updateSqlServerRow` / `deleteSqlServerRow`
  and `…/rows/route.ts` already exist; only the UI is unwired. Once
  `SqlTableDetail` owns row actions, this is flipping two capability flags.
- **MySQL Constraints + Foreign keys tabs.** Genuinely absent — `mysql.ts` has
  no constraint or FK introspection at all. Needs `listConstraints` /
  `listForeignKeys` in `mysql/catalog.ts`, an API route, and the capability
  flags.

`compose.yaml` currently defines postgres, sqlserver and kafka but no MySQL, so
the new MySQL driver code has no integration coverage. L3 adds a `mysql`
service and extends `services.integration.test.ts`.

## Error handling

Unchanged in kind. Driver modules keep throwing; API routes keep wrapping with
`formatError` from `src/lib/errors.ts`. `DriverNotInstalledError` still
surfaces as 503 through `errorResponse`. The shared `SqlTableDetail` renders a
single error surface per tab rather than the three current variants, so an
`AggregateError` from a dead connection reads the same in every SQL workspace.

## Testing

| layer | proof |
|---|---|
| SSE straggler | existing assistant tests + manual stream check |
| L0 | `tsc --noEmit` (pure movement, names unchanged) + existing `postgres-pool`, `postgres-readonly`, `sqlserver-readonly`, `sql-safety` suites + `services.integration.test.ts` |
| safety net | the new tests are themselves the deliverable |
| L1, L2 | safety-net tests pass **unchanged** |
| L3 | safety-net tests updated deliberately + new MySQL integration tests against the new compose service |

Every branch runs `npm run typecheck && npm run lint && npm test && npm run build`.

## Sequencing

One branch each, merged in order:

1. `refactor/sse-parser` — assistant-client uses `SseFrameParser`
2. `refactor/driver-split-postgres` — L0
3. `refactor/driver-split-sqlserver` — L0
4. `test/sql-workspace-characterization` — safety net
5. `refactor/sql-ui-primitives` — L1
6. `refactor/sql-table-detail-shell` — L2
7. `feat/sql-workspace-convergence` — L3
8. `docs/roadmap-refresh` — see below

## Roadmap refresh

`docs/ROADMAP.md` is stale and misleading and is corrected in the final branch:

- Postgres Phase 2's "Up next" items — EXPLAIN visualizer, Activity, Roles —
  all shipped.
- "Stretch — other techs" lists Redis and MongoDB as future work; both are
  registered tech modules today. The catalog is 12 techs, not 3.
- Command-palette coverage is 10 of 12; `kubernetes` and `redis` still lack
  `commandObjects`. This is real remaining work and belongs on the roadmap.
- The roadmap gains this refactor as its own phase.
