# SQL Refactor Phase 1 — Driver Split & Safety Net — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the two SQL driver monoliths into focused modules behind
name-identical barrels, and build the characterization test suite that will
protect the UI refactor that follows.

**Architecture:** Three moves. (1) Fix the last hand-rolled SSE parser by
extracting the assistant's stream loop into a testable helper backed by the
canonical `SseFrameParser`. (2) Split `postgres.ts` (3689 LOC / 72 exports) and
`sqlserver.ts` (2947 LOC / 48 exports) into eight modules each; the original
paths survive as barrels so all 74 import sites stay byte-identical. (3) Write
the component and e2e tests that currently do not exist for the three SQL
workspaces, so Phase 2's UI extraction has something to regress against.

**Tech Stack:** TypeScript, Next.js 16 App Router, vitest (three projects:
`server`/node, `client`/happy-dom, `integration`), @testing-library/react,
Playwright.

**Source spec:** `docs/superpowers/specs/2026-08-08-sql-workspace-refactor-design.md`

## Global Constraints

- **No exported name changes in this phase.** `sqlserver.ts`'s `xxxSqlServer`
  prefixes stay exactly as they are. L0 is pure file movement, provable by
  `tsc --noEmit`.
- **No behaviour changes in this phase.** Task 1 is the sole exception and it is
  a bugfix with a failing test to prove it.
- Every route file keeps `export const runtime = "nodejs";`.
- Errors keep going through `formatError` from `src/lib/errors.ts`.
- `DriverNotInstalledError` lazy-import guards (`getPg`, `getPgCursor`, the
  mssql equivalent) must remain the only path to the npm driver, so a missing
  optional dependency still yields 503 rather than a module-resolution crash.
- SQL safety rules from AGENTS.md are unchanged: `quoteIdent`,
  `validateIdentifier`, `requireNoStatementTerminator` remain the single
  gatekeepers and every DDL module imports them from `<tech>/sql.ts`.
- Verification for every task: `npm run typecheck && npm run lint && npm test`.
  Tasks 2 and 3 additionally run `npm run build`.
- Commit at the end of each task. One branch per task group as listed in the
  spec's sequencing section.

## Scope

This plan covers spec branches 1–4. Branches 5–8 (L1 primitives, L2 shell, L3
convergence, roadmap refresh) get their own plan, written after Task 6 lands —
the L2 descriptor's props cannot be honestly specified until L1 extraction shows
what the components actually share.

## File Structure

**Created:**

| file | responsibility |
|---|---|
| `src/app/assistant/stream.ts` | Consume the assistant SSE response body, dispatch typed events to handlers |
| `src/app/assistant/stream.test.ts` | Unit tests for the above |
| `src/lib/connections/postgres/{client,sql,catalog,rows,ddl,query,ops,backup}.ts` | The eight postgres driver modules |
| `src/lib/connections/sqlserver/{client,sql,catalog,rows,ddl,query,ops,backup}.ts` | The eight sqlserver driver modules |
| `src/lib/connections/postgres.barrel.test.ts` | Locks the postgres public surface |
| `src/lib/connections/sqlserver.barrel.test.ts` | Locks the sqlserver public surface |
| `src/test/sse.ts` | Test helper: build a `ReadableStream<Uint8Array>` from strings |
| `src/test/fetch-mock.ts` | Test helper: route mocked `fetch` calls by URL pattern |
| `src/app/{postgres,mysql,sqlserver}/…/table-detail-client.dom.test.tsx` | Characterization tests, three files |
| `src/app/{postgres,mysql,sqlserver}/…/query-editor-client.dom.test.tsx` | Characterization tests, three files |
| `e2e/sql-workspaces.spec.ts` | Playwright smoke across the three SQL techs |

**Modified:**

| file | change |
|---|---|
| `src/app/assistant/assistant-client.tsx:309-330` | Replace the inline parse loop with `consumeAssistantStream` |
| `src/lib/connections/postgres.ts` | Becomes a barrel (~15 lines) |
| `src/lib/connections/sqlserver.ts` | Becomes a barrel (~15 lines) |

---

### Task 1: Assistant SSE stream helper

The assistant hand-rolls SSE parsing instead of using `SseFrameParser`. It has
two real defects:

1. `frame.split("\n").find((l) => l.startsWith("data: "))` takes only the
   **first** `data:` line. The SSE spec allows a payload to span multiple
   `data:` lines, joined with `\n`. Multi-line payloads are silently truncated.
2. `JSON.parse(dl.slice(6))` is unguarded. A non-JSON `data:` line throws out of
   the read loop into the function's outer `catch {}`, which swallows it — the
   stream dies mid-answer with no error shown to the user.

`SseFrameParser` (`src/lib/sse-client.ts`) already joins data lines, skips `:`
comments, and falls back to the raw string when `JSON.parse` fails.

**Files:**
- Create: `src/app/assistant/stream.ts`
- Create: `src/app/assistant/stream.test.ts`
- Create: `src/test/sse.ts`
- Modify: `src/app/assistant/assistant-client.tsx:309-330`

**Interfaces:**
- Consumes: `SseFrameParser`, `SseFrame` from `@/lib/sse-client`;
  `PendingApproval` from `@/components/ai/approval-card`; `ProposedPlan` from
  `@/components/ai/plan-card`; `ToolChip` from `@/components/ai/message-list`.
- Produces: `consumeAssistantStream(body, handlers)` and
  `AssistantStreamHandlers`, used by `assistant-client.tsx`. `streamOf(...chunks)`
  from `src/test/sse.ts`, reused by no other task but available.

- [ ] **Step 1: Write the test helper**

`src/test/sse.ts`:

```ts
/** Build a ReadableStream<Uint8Array> that emits each string as one chunk. */
export function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}
```

- [ ] **Step 2: Write the failing tests**

`src/app/assistant/stream.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { streamOf } from "@/test/sse";
import { consumeAssistantStream, type AssistantStreamHandlers } from "./stream";

function handlers(): AssistantStreamHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    onTextDelta: (t) => calls.push(`text:${t}`),
    onToolCall: (d) => calls.push(`tool:${d.tool}`),
    onApprovalNeeded: (d) => calls.push(`approval:${d.toolCallId}`),
    onPlan: () => calls.push("plan"),
    onError: (m) => calls.push(`error:${m}`),
  };
}

describe("consumeAssistantStream", () => {
  it("dispatches each event type to its handler", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf(
        'event: text-delta\ndata: {"text":"hi"}\n\n',
        'event: tool-call\ndata: {"toolCallId":"t1","tool":"pg_list_tables"}\n\n',
        'event: error\ndata: {"error":"boom"}\n\n',
      ),
      h,
    );
    expect(h.calls).toEqual(["text:hi", "tool:pg_list_tables", "error:boom"]);
  });

  it("reassembles a payload split across chunk boundaries", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf('event: text-delta\ndata: {"te', 'xt":"split"}\n\n'),
      h,
    );
    expect(h.calls).toEqual(["text:split"]);
  });

  // Defect 1: the old .find() took only the first data: line.
  it("joins a payload spanning multiple data: lines", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf('event: text-delta\ndata: {"text":"line one\ndata: line two"}\n\n'),
      h,
    );
    expect(h.calls).toEqual(["text:line one\nline two"]);
  });

  // Defect 2: the old unguarded JSON.parse killed the whole stream.
  it("survives a non-JSON data line and keeps consuming", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf(
        "event: text-delta\ndata: not json\n\n",
        'event: text-delta\ndata: {"text":"after"}\n\n',
      ),
      h,
    );
    expect(h.calls).toEqual(["text:after"]);
  });

  it("ignores heartbeat comments", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf(": ping\n\n", 'event: text-delta\ndata: {"text":"ok"}\n\n'),
      h,
    );
    expect(h.calls).toEqual(["text:ok"]);
  });

  it("ignores unknown event names without throwing", async () => {
    const h = handlers();
    await consumeAssistantStream(
      streamOf('event: future-thing\ndata: {"x":1}\n\n'),
      h,
    );
    expect(h.calls).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npx vitest run src/app/assistant/stream.test.ts`
Expected: FAIL — `Failed to resolve import "./stream"`.

- [ ] **Step 4: Write the implementation**

`src/app/assistant/stream.ts`:

```ts
import { SseFrameParser } from "@/lib/sse-client";
import type { PendingApproval } from "@/components/ai/approval-card";
import type { ProposedPlan } from "@/components/ai/plan-card";

export interface AssistantStreamHandlers {
  onTextDelta(text: string): void;
  onToolCall(data: { toolCallId: string; tool: string; args?: { connection?: string } }): void;
  onApprovalNeeded(data: PendingApproval): void;
  onPlan(data: Omit<ProposedPlan, "sessionId">): void;
  onError(message: string): void;
}

/**
 * Read an assistant SSE response body to completion, dispatching frames to
 * `handlers`. Frame parsing is delegated to the canonical SseFrameParser, which
 * joins multi-line `data:` payloads, skips `:` comments, and leaves
 * unparseable payloads as raw strings rather than throwing.
 *
 * A frame whose payload is not an object is dropped: every event this consumer
 * understands carries a JSON object, so a bare string means a malformed frame,
 * and dropping it keeps the stream alive.
 */
export async function consumeAssistantStream(
  body: ReadableStream<Uint8Array>,
  handlers: AssistantStreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseFrameParser();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
      if (typeof frame.data !== "object" || frame.data === null) continue;
      const data = frame.data as Record<string, unknown>;
      switch (frame.event) {
        case "text-delta":
          handlers.onTextDelta(String(data.text ?? ""));
          break;
        case "tool-call":
          handlers.onToolCall(data as unknown as Parameters<AssistantStreamHandlers["onToolCall"]>[0]);
          break;
        case "approval-needed":
          handlers.onApprovalNeeded(data as unknown as PendingApproval);
          break;
        case "plan":
          handlers.onPlan(data as unknown as Omit<ProposedPlan, "sessionId">);
          break;
        case "error":
          handlers.onError(String(data.error ?? "unknown error"));
          break;
        default:
          break; // forward-compatible: unknown events are ignored
      }
    }
  }
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/app/assistant/stream.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire it into the component**

In `src/app/assistant/assistant-client.tsx`, add to the imports:

```ts
import { consumeAssistantStream } from "./stream";
```

Replace lines 309–330 — everything from `const reader = res.body.getReader();`
down to the closing brace of the outer `for (;;)` loop, inclusive — with:

```ts
      await consumeAssistantStream(res.body, {
        onTextDelta: (text) => setMessages((m) => appendLast(m, text)),
        onToolCall: (d) =>
          setChips((c) => [...c, { toolCallId: d.toolCallId, tool: d.tool, connection: d.args?.connection }]),
        onApprovalNeeded: (d) => setPending((p) => [...p, d]),
        onPlan: (d) => setPlan({ sessionId: sessionRef.current, ...d }),
        onError: (msg) => setMessages((m) => patchLast(m, `⚠️ ${msg}`)),
      });
```

The `refreshList()` call that follows the loop stays where it is.

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass. `decoder`, `buf` and the old locals should now be gone — if
lint reports an unused variable, delete it.

- [ ] **Step 8: Commit**

```bash
git checkout -b refactor/sse-parser
git add src/app/assistant/stream.ts src/app/assistant/stream.test.ts \
        src/test/sse.ts src/app/assistant/assistant-client.tsx
git commit -m "fix(assistant): use the canonical SSE parser for the chat stream

The inline parser took only the first data: line of a frame, truncating
multi-line payloads, and its unguarded JSON.parse threw out of the read
loop into a bare catch — a malformed frame killed the stream silently.

Extracts the loop into consumeAssistantStream() backed by SseFrameParser,
with tests covering both defects."
```

---

### Task 2: Split `postgres.ts`

Pure file movement. The proof is that nothing outside the new directory
changes: `tsc --noEmit` passes, every existing suite passes, and a new barrel
test asserts the public surface is intact.

**Files:**
- Create: `src/lib/connections/postgres/{client,sql,catalog,rows,ddl,query,ops,backup}.ts`
- Create: `src/lib/connections/postgres.barrel.test.ts`
- Modify: `src/lib/connections/postgres.ts` (3689 lines → ~15-line barrel)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the eight module paths above. Every name currently exported from
  `src/lib/connections/postgres.ts` remains importable from that same path,
  unchanged in name and signature. Task 3 mirrors this structure for sqlserver.

- [ ] **Step 1: Write the characterization test for the public surface**

This runs against the *current monolith* and must pass before the split. It is
the contract the split must not break.

`src/lib/connections/postgres.barrel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as pg from "./postgres";

/**
 * The full public surface of the postgres driver, captured before the module
 * split. Every name here must remain importable from
 * "@/lib/connections/postgres" — 39 call sites depend on it.
 *
 * To regenerate after a deliberate API change:
 *   grep -o '^export \(async \)\?function [a-zA-Z_]*' src/lib/connections/postgres.ts \
 *     | awk '{print $NF}' | sort
 */
const EXPECTED_FUNCTIONS = [
  "withClient",
  "dropPostgresPools",
  "getPoolForTests",
  "_injectPoolForTests",
  "_endAllPostgresPoolsForTests",
  "probePostgres",
  "getServerOverview",
  "getTopTables",
  "getTopTablesAllDatabases",
  "listDatabases",
  "listSchemas",
  "listSchemasWithStats",
  "listObjects",
  "listAllRelations",
  "listSchemaColumns",
  "listColumns",
  "listIndexes",
  "listConstraints",
  "listForeignKeys",
  "readTableData",
  "quoteIdent",
  "insertRow",
  "updateRow",
  "createTable",
  "deleteRow",
  "listFunctions",
  "listSequences",
  "getTableStats",
  "createSequence",
  "alterSequence",
  "dropSequence",
  "createOrReplaceFunction",
  "dropFunction",
  "getFunctionDefinition",
  "createIndex",
  "dropIndex",
  "renameIndex",
  "createOrReplaceView",
  "getViewDefinition",
  "getTableDDL",
  "validateIdentifier",
  "requireNoStatementTerminator",
  "createDatabase",
  "dropDatabase",
  "listRoles",
  "createRole",
  "alterRole",
  "dropRole",
  "createSchema",
  "dropSchema",
  "dropTable",
  "dropView",
  "alterTable",
  "explainQuery",
  "runQuery",
  "runReadOnlyQuery",
  "splitSqlStatements",
  "runQueryMulti",
  "listActivity",
  "cancelBackend",
  "terminateBackend",
  "listBlockingTree",
  "runMaintenance",
  "reindexTable",
  "getOverviewExtras",
  "getDiagnostics",
  "listExtensions",
  "createExtension",
  "dropExtension",
  "updateExtension",
  "streamDatabaseDump",
  "restoreSql",
] as const;

describe("postgres driver barrel", () => {
  it("re-exports every public function", () => {
    const missing = EXPECTED_FUNCTIONS.filter(
      (name) => typeof (pg as unknown as Record<string, unknown>)[name] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("exports exactly the documented surface — no accidental additions", () => {
    const actual = Object.keys(pg)
      .filter((k) => typeof (pg as unknown as Record<string, unknown>)[k] === "function")
      .sort();
    expect(actual).toEqual([...EXPECTED_FUNCTIONS].sort());
  });
});
```

- [ ] **Step 2: Run it against the monolith**

Run: `npx vitest run src/lib/connections/postgres.barrel.test.ts`
Expected: PASS. If the second test fails, the list above drifted from reality —
regenerate it with the `grep` command in the file's comment and use the actual
names. Do **not** proceed until it passes; this test is the whole safety
argument for the split.

- [ ] **Step 3: Commit the characterization test alone**

```bash
git checkout -b refactor/driver-split-postgres
git add src/lib/connections/postgres.barrel.test.ts
git commit -m "test(postgres): lock the driver's public surface before the split"
```

- [ ] **Step 4: Create `postgres/client.ts`**

Move, verbatim, from `postgres.ts` lines 1–137: the `pg` and `pg-cursor`
type imports and lazy `getPg` / `getPgCursor` guards, `buildClientConfig`, the
whole pooling block (`PgPoolCache`, `poolCacheKey`, `poolCache`, `poolIdentity`,
`poolKey`, `getPool`), `withClient`, `dropPostgresPools`, and the three test
seams (`getPoolForTests`, `_injectPoolForTests`, `_endAllPostgresPoolsForTests`).
Then move `probePostgres` and the `PostgresProbe` interface (lines 138–163).

`getPg` and `getPgCursor` are used by other modules, so add `export` to both.
Everything else that was module-private stays private.

- [ ] **Step 5: Create `postgres/sql.ts`**

Move `quoteIdent` (line 940), `validateIdentifier` (1640),
`requireNoStatementTerminator` (1655), `splitSqlStatements` (2283). This module
imports nothing from the other seven — it is the leaf.

- [ ] **Step 6: Create `postgres/catalog.ts`**

Move the read-only introspection functions and their result interfaces:
`DatabaseInfo`, `listDatabases`, `SchemaInfo`, `listSchemas`, `SchemaStats`,
`listSchemasWithStats`, `ObjectKind`, `SchemaObject`, `listObjects`,
`RelationListing`, `listAllRelations`, `ColumnInfo`, `listSchemaColumns`,
`listColumns`, `IndexInfo`, `listIndexes`, `ConstraintInfo`, `listConstraints`,
`ForeignKeyInfo`, `listForeignKeys`, `FunctionInfo`, `listFunctions`,
`SequenceInfo`, `listSequences`, `TableStats`, `getTableStats`,
`getFunctionDefinition`, `getViewDefinition`, `getTableDDL`.

Imports `withClient` from `./client` and `quoteIdent` from `./sql`.

- [ ] **Step 7: Create `postgres/rows.ts`**

Move `TableData`, `readTableData`, `ColumnValue`, `PrimaryKeyValue`,
`insertRow`, `updateRow`, `deleteRow`. Imports `withClient` from `./client`,
`quoteIdent` from `./sql`.

- [ ] **Step 8: Create `postgres/ddl.ts`**

Move `CreateTableColumnInput`, `CreateTableInput`, `createTable`,
`SequenceOptions`, `createSequence`, `alterSequence`, `dropSequence`,
`createOrReplaceFunction`, `dropFunction`, `CreateIndexInput`, `createIndex`,
`dropIndex`, `renameIndex`, `createOrReplaceView`, `createDatabase`,
`dropDatabase`, `createSchema`, `dropSchema`, `dropTable`, `dropView`,
`AlterTableOp`, `alterTable`, `InstalledExtension`, `AvailableExtension`,
`ExtensionsListing`, `listExtensions`, `createExtension`, `dropExtension`,
`updateExtension`.

Imports `withClient` from `./client`, and `quoteIdent` / `validateIdentifier` /
`requireNoStatementTerminator` from `./sql`. Every free-form SQL fragment in
this module must keep its existing `requireNoStatementTerminator` call — do not
drop one while moving.

- [ ] **Step 9: Create `postgres/query.ts`**

Move `QueryResult`, `ExplainResult`, `ExplainPlanRoot`, `ExplainPlanNode`,
`explainQuery`, `runQuery`, `runReadOnlyQuery`, `QueryStatementResult`,
`QueryStatementError`, `MultiQueryResult`, `runQueryMulti`. Imports `withClient`
from `./client`, `splitSqlStatements` from `./sql`.

- [ ] **Step 10: Create `postgres/ops.ts`**

Move `ServerOverview`, `getServerOverview`, `TopTable`, `getTopTables`,
`getTopTablesAllDatabases`, `ActivityRow`, `ActivitySnapshot`, `listActivity`,
`cancelBackend`, `terminateBackend`, `LockEdge`, `listBlockingTree`,
`MaintenanceMode`, `runMaintenance`, `reindexTable`, `OverviewExtras`,
`getOverviewExtras`, `ReplicationSlot`, `ReplicationPeer`, `DatabaseAge`,
`AutovacuumActive`, `DiagnosticsSnapshot`, `getDiagnostics`, `RoleInfo`,
`listRoles`, `RoleAttrs`, `createRole`, `alterRole`, `dropRole`.

- [ ] **Step 11: Create `postgres/backup.ts`**

Move `DumpOptions`, `streamDatabaseDump`, `RestoreResult`, `restoreSql`. This is
the only consumer of `getPgCursor` — import it from `./client`.

- [ ] **Step 12: Replace `postgres.ts` with the barrel**

```ts
/**
 * Postgres driver — barrel.
 *
 * The implementation lives in ./postgres/*. This file exists so the 39
 * existing import sites keep working unchanged; prefer importing from the
 * specific module in new code.
 */
export * from "./postgres/client";
export * from "./postgres/sql";
export * from "./postgres/catalog";
export * from "./postgres/rows";
export * from "./postgres/ddl";
export * from "./postgres/query";
export * from "./postgres/ops";
export * from "./postgres/backup";
```

- [ ] **Step 13: Verify the split changed nothing**

Run: `npm run typecheck`
Expected: clean. Any error names the exact symbol you failed to move or export.

Run: `npx vitest run src/lib/connections/postgres.barrel.test.ts`
Expected: PASS, both tests. The second one catches a name you accidentally
exported that was previously private.

Run: `npm test && npm run lint && npm run build`
Expected: all pass. `postgres-pool.test.ts`, `postgres-readonly.test.ts` and
`sql-safety.test.ts` are the ones that matter most here.

- [ ] **Step 14: Verify against a live server**

Run: `docker compose up -d postgres && npm run test:integration`
Expected: the `postgres` describe block runs (not skipped) and passes. If it
reports `[skip] postgres not reachable on localhost:5432`, the container is not
up — the integration pass has not actually happened, so do not claim it did.

- [ ] **Step 15: Commit**

```bash
git add src/lib/connections/postgres.ts src/lib/connections/postgres/
git commit -m "refactor(postgres): split the 3689-line driver into eight modules

client / sql / catalog / rows / ddl / query / ops / backup, behind a barrel
at the original path. No exported name or signature changes; all 39 import
sites are untouched."
```

---

### Task 3: Split `sqlserver.ts`

Same shape as Task 2. Read Task 2 in full before starting — the reasoning,
the ordering and the verification steps are identical, and this task does not
repeat them.

**Files:**
- Create: `src/lib/connections/sqlserver/{client,sql,catalog,rows,ddl,query,ops,backup}.ts`
- Create: `src/lib/connections/sqlserver.barrel.test.ts`
- Modify: `src/lib/connections/sqlserver.ts` (2947 lines → ~15-line barrel)

**Interfaces:**
- Consumes: the module layout established in Task 2 — mirror it exactly.
- Produces: every name currently exported from `src/lib/connections/sqlserver.ts`
  remains importable from that path. The `xxxSqlServer` prefixes are preserved
  verbatim; renaming is explicitly out of scope for this phase.

- [ ] **Step 1: Write the characterization test**

`src/lib/connections/sqlserver.barrel.test.ts`, structured exactly like
`postgres.barrel.test.ts` in Task 2 Step 1 (both tests: every expected name is a
function, and no accidental additions). Generate the name list rather than
hand-typing it:

```bash
grep -o '^export \(async \)\?function [a-zA-Z_]*' src/lib/connections/sqlserver.ts \
  | awk '{print $NF}' | sort | sed 's/^/  "/; s/$/",/'
```

Paste the output as `EXPECTED_FUNCTIONS`. It should be 48 names, including
`probeSqlServer`, `getSqlServerOverview`, `listSqlServerDatabases`,
`validateSqlServerDatabaseName`, `createSqlServerDatabase`,
`requireNoStatementTerminator`, `createSqlServerTable`, `dropSqlServerDatabase`,
`dropSqlServerSchema`, `dropSqlServerObject`, `insertSqlServerRow`,
`updateSqlServerRow`, `deleteSqlServerRow`, `alterSqlServerTable`,
`createSqlServerSequence`, `createSqlServerSynonym`, `createSqlServerType`,
`createSqlServerTableType`, `executeSqlServerDdl`, `listSqlServerSchemas`,
`listSqlServerSchemaColumns`, `createSqlServerSchema`, `listSqlServerTables`,
`splitGoBatches`, `runSqlServerScript`, `runReadOnlyQuery`, `classifyWait`,
`listSqlServerActivity`, `killSqlServerSession`, `validateSqlServerIdentifier`,
`listSqlServerObjects`, `getSqlServerTableDetail`, `getSqlServerTableData`,
`buildSqlServerTableDDL`, `getSqlServerModule`, `getSqlServerEstimatedPlan`,
`getSqlServerExpensiveQueries`, `listSqlServerBlocking`,
`getSqlServerOverviewExtras`, `getQueryStore`, `setQueryStorePlanForced`,
`getSqlServerIndexFragmentation`, `maintainSqlServerIndex`,
`getSqlServerMissingIndexes`, `getSqlServerBackupHistory`,
`backupSqlServerDatabase`, `getSqlServerSecurity`, `getSqlServerDependencies`.

Note that `SQLSERVER_DB_NAME_RE` is a `const`, not a function — the surface test
only covers functions, matching Task 2.

- [ ] **Step 2: Run it against the monolith**

Run: `npx vitest run src/lib/connections/sqlserver.barrel.test.ts`
Expected: PASS. Fix the list until it does before splitting anything.

- [ ] **Step 3: Commit the characterization test alone**

```bash
git checkout -b refactor/driver-split-sqlserver
git add src/lib/connections/sqlserver.barrel.test.ts
git commit -m "test(sqlserver): lock the driver's public surface before the split"
```

- [ ] **Step 4: Create the eight modules**

Map the current file onto the Task 2 layout:

| module | contents |
|---|---|
| `client.ts` | the `mssql` lazy-import guard, connection/pool helpers, `probeSqlServer` |
| `sql.ts` | `SQLSERVER_DB_NAME_RE`, `validateSqlServerDatabaseName`, `validateSqlServerIdentifier`, `requireNoStatementTerminator`, `splitGoBatches` |
| `catalog.ts` | `listSqlServerDatabases`, `listSqlServerSchemas`, `listSqlServerSchemaColumns`, `listSqlServerTables`, `listSqlServerObjects`, `getSqlServerTableDetail`, `getSqlServerModule`, `getSqlServerDependencies`, `buildSqlServerTableDDL`, and the `SqlServerTableSummary` / `SqlServerDatabaseDetail` / `SqlServerColumn` / `SqlServerIndex` / `SqlServerConstraintRow` / `SqlServerForeignKeyRow` / `SqlServerTableDetail` / `SqlServerObject` / `SqlServerParam` / `SqlServerModule` / `SqlServerDependency` types |
| `rows.ts` | `SqlServerColumnValue`, `SqlServerPrimaryKeyValue`, `SqlServerTableData`, `getSqlServerTableData`, `insertSqlServerRow`, `updateSqlServerRow`, `deleteSqlServerRow` |
| `ddl.ts` | `CreateSqlServerColumnInput`, `CreateSqlServerTableInput`, `createSqlServerTable`, `createSqlServerDatabase`, `dropSqlServerDatabase`, `dropSqlServerSchema`, `dropSqlServerObject`, `createSqlServerSchema`, `SqlServerAlterTableOp`, `alterSqlServerTable`, the sequence / synonym / type / table-type creators, `executeSqlServerDdl` |
| `query.ts` | `SqlServerResultSet`, `SqlServerBatchResult`, `SqlServerMultiResult`, `runSqlServerScript`, `ReadOnlyResult`, `runReadOnlyQuery`, `PlanNode`, `MissingIndex`, `SqlServerPlan`, `getSqlServerEstimatedPlan` |
| `ops.ts` | `SqlServerOverview`, `getSqlServerOverview`, `SqlServerSession`, `classifyWait`, `listSqlServerActivity`, `killSqlServerSession`, `ExpensiveQuery`, `getSqlServerExpensiveQueries`, `SqlServerBlockNode`, `listSqlServerBlocking`, `SqlServerBlockerChain`, `SqlServerWaitBucket`, `SqlServerOverviewExtras`, `getSqlServerOverviewExtras`, `QueryStoreStatus`, `QueryStoreQuery`, `getQueryStore`, `setQueryStorePlanForced`, `IndexFragmentation`, `getSqlServerIndexFragmentation`, `maintainSqlServerIndex`, `SqlServerMissingIndex`, `getSqlServerMissingIndexes`, `SqlServerLogin`, `SqlServerUser`, `getSqlServerSecurity` |
| `backup.ts` | `BackupHistoryRow`, `getSqlServerBackupHistory`, `backupSqlServerDatabase` |

`SqlServerProbeResult` and `SqlServerDatabaseSummary` go with `client.ts` and
`catalog.ts` respectively.

- [ ] **Step 5: Replace `sqlserver.ts` with the barrel**

```ts
/**
 * SQL Server driver — barrel.
 *
 * The implementation lives in ./sqlserver/*. This file exists so the 35
 * existing import sites keep working unchanged; prefer importing from the
 * specific module in new code.
 */
export * from "./sqlserver/client";
export * from "./sqlserver/sql";
export * from "./sqlserver/catalog";
export * from "./sqlserver/rows";
export * from "./sqlserver/ddl";
export * from "./sqlserver/query";
export * from "./sqlserver/ops";
export * from "./sqlserver/backup";
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run src/lib/connections/sqlserver.barrel.test.ts`
Expected: PASS, both tests.

Run: `npm test && npm run lint && npm run build`
Expected: all pass, `sqlserver-readonly.test.ts` included.

Run: `docker compose up -d sqlserver && npm run test:integration`
Expected: the `sqlserver` describe block runs and passes. If it logs
`[skip] sqlserver not reachable on localhost:1433`, it did not run — say so
rather than reporting a pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/connections/sqlserver.ts src/lib/connections/sqlserver/
git commit -m "refactor(sqlserver): split the 2947-line driver into eight modules

Mirrors the postgres layout: client / sql / catalog / rows / ddl / query /
ops / backup behind a barrel at the original path. Exported names keep their
xxxSqlServer prefixes; all 35 import sites are untouched."
```

---

### Task 4: `fetch` mock helper + postgres table-detail characterization tests

Everything from here is the safety net. These tests describe what the three
workspaces do **today**, including behaviour that Phase 2 will deliberately
change — that is the point. When Phase 2 changes one, the diff to the test is
the evidence of what changed.

**Files:**
- Create: `src/test/fetch-mock.ts`
- Create: `src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/table-detail-client.dom.test.tsx`

**Interfaces:**
- Consumes: `TableDetailClient` from
  `./table-detail-client`, props `{ connectionId: string; db: string; schema: string; table: string }`.
- Produces: `mockFetch(routes)` from `src/test/fetch-mock.ts`, used by Tasks 5
  and 6's component tests.

- [ ] **Step 1: Write the fetch mock helper**

`src/test/fetch-mock.ts`:

```ts
import { vi } from "vitest";

export type RouteMap = Record<string, unknown | ((url: string) => unknown)>;

/**
 * Install a `fetch` stub that matches request URLs against substrings.
 *
 * Routes are tested in declaration order, so put the most specific first.
 * An unmatched URL rejects loudly rather than hanging the component in a
 * permanent loading state — a silent 404 makes these tests very hard to debug.
 *
 * Returns a restore function; call it in afterEach.
 */
export function mockFetch(routes: RouteMap): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [pattern, payload] of Object.entries(routes)) {
      if (!url.includes(pattern)) continue;
      const body = typeof payload === "function" ? (payload as (u: string) => unknown)(url) : payload;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`mockFetch: no route matched ${url}`);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
```

- [ ] **Step 2: Write the postgres characterization test**

`table-detail-client.dom.test.tsx` in the postgres tables directory:

```tsx
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";
import { TableDetailClient } from "./table-detail-client";

const COLUMNS = [
  { name: "id", dataType: "integer", nullable: false, defaultValue: "nextval('t_id_seq')", isPrimaryKey: true },
  { name: "email", dataType: "text", nullable: false, defaultValue: null, isPrimaryKey: false },
];

const ROWS = {
  columns: ["id", "email"],
  rows: [
    { id: 1, email: "a@example.com" },
    { id: 2, email: "b@example.com" },
  ],
  total: 2,
};

let restore: () => void;

beforeEach(() => {
  restore = mockFetch({
    "view=ddl": { ddl: "CREATE TABLE public.users (…);" },
    "view=stats": { stats: { rowEstimate: 2, totalBytes: 8192, indexBytes: 4096 } },
    "view=indexes": { indexes: [{ name: "users_pkey", definition: "CREATE UNIQUE INDEX …", isPrimary: true }] },
    "view=constraints": { constraints: [] },
    "view=foreign_keys": { foreignKeys: [] },
    "view=structure": { columns: COLUMNS },
    "/rows": ROWS,
    // Least specific last: the default data view.
    "/tables/users": { columns: COLUMNS, ...ROWS },
  });
});

afterEach(() => restore());

function renderIt() {
  return render(
    <TableDetailClient connectionId="c1" db="appdb" schema="public" table="users" />,
  );
}

describe("postgres TableDetailClient (characterization)", () => {
  it("renders all seven tabs", async () => {
    renderIt();
    for (const label of [
      "Data", "Structure", "Indexes", "Constraints", "Foreign keys", "DDL", "Statistics",
    ]) {
      expect(await screen.findByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  it("shows row data on the default Data tab", async () => {
    renderIt();
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
  });

  it("offers row-level insert, edit and delete", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.getByRole("button", { name: /insert/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /edit/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /delete/i }).length).toBeGreaterThan(0);
  });

  it("fetches per-tab: the DDL view is not requested until its tab opens", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    const calls = () =>
      (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
    expect(calls().some((u) => u.includes("view=ddl"))).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "DDL" }));
    await waitFor(() => expect(calls().some((u) => u.includes("view=ddl"))).toBe(true));
  });

  it("renders the column list on the Structure tab", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("tab", { name: "Structure" }));
    expect(await screen.findByText("email")).toBeInTheDocument();
    expect(screen.getByText("integer")).toBeInTheDocument();
  });

  it("surfaces a fetch failure instead of spinning forever", async () => {
    restore();
    restore = mockFetch({}); // every URL rejects
    renderIt();
    expect(await screen.findByText(/no route matched|error|failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run and iterate until green**

Run: `npx vitest run "src/app/postgres/**/table-detail-client.dom.test.tsx"`

These assertions are written from reading the component, not from running it.
Expect to adjust selectors — accessible names, tab labels and empty-state copy
may differ. **Adjust the test to match the component; never adjust the
component to match the test.** This task documents current behaviour. If an
assertion cannot be made to pass because the behaviour genuinely is not there,
delete that assertion and note it in the commit message.

- [ ] **Step 4: Commit**

```bash
git checkout -b test/sql-workspace-characterization
git add src/test/fetch-mock.ts "src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/table-detail-client.dom.test.tsx"
git commit -m "test(postgres): characterize the table detail workspace

Locks the seven-tab layout, per-tab lazy fetching, row CRUD affordances and
the error surface before the shared-component refactor."
```

---

### Task 5: MySQL and SQL Server table-detail characterization tests

**Files:**
- Create: `src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.dom.test.tsx`
- Create: `src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.dom.test.tsx`

**Interfaces:**
- Consumes: `mockFetch` from `@/test/fetch-mock` (Task 4). MySQL's
  `TableDetailClient` takes `{ connectionId, db, table }`; SQL Server's takes
  `{ connectionId, database, schema, table }` — note the prop name differs
  (`db` vs `database`), which Phase 2 normalizes.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the MySQL test**

`table-detail-client.dom.test.tsx` in the mysql tables directory:

```tsx
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";
import { TableDetailClient } from "./table-detail-client";

const COLUMNS = [
  { name: "id", dataType: "int", nullable: false, defaultValue: null, isPrimaryKey: true },
  { name: "email", dataType: "varchar(255)", nullable: false, defaultValue: null, isPrimaryKey: false },
];

const ROWS = {
  columns: ["id", "email"],
  rows: [
    { id: 1, email: "a@example.com" },
    { id: 2, email: "b@example.com" },
  ],
  total: 2,
};

const META = {
  columns: COLUMNS,
  indexes: [{ name: "PRIMARY", columns: ["id"], unique: true }],
  ddl: "CREATE TABLE `users` (…);",
};

let restore: () => void;

function calls(): string[] {
  return (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  restore = mockFetch({
    "/rows": ROWS,
    "/tables/users": META,
  });
});

afterEach(() => restore());

function renderIt() {
  return render(<TableDetailClient connectionId="c1" db="appdb" table="users" />);
}

describe("mysql TableDetailClient (characterization)", () => {
  it("renders exactly four tabs", async () => {
    renderIt();
    for (const label of ["Data", "Structure", "Indexes", "DDL"]) {
      expect(await screen.findByRole("tab", { name: label })).toBeInTheDocument();
    }
  });

  // Phase 2 adds these. Their absence is the thing being recorded.
  it("has no Constraints, Foreign keys or Statistics tab today", async () => {
    renderIt();
    await screen.findByRole("tab", { name: "Data" });
    expect(screen.queryByRole("tab", { name: "Constraints" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Foreign keys" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Statistics" })).toBeNull();
  });

  it("shows row data on the default Data tab", async () => {
    renderIt();
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("b@example.com")).toBeInTheDocument();
  });

  // The inverse of postgres: one payload up front, no per-tab request.
  it("fetches once up front — opening DDL issues no new request", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    const before = calls().length;
    fireEvent.click(screen.getByRole("tab", { name: "DDL" }));
    await screen.findByText(/CREATE TABLE/);
    expect(calls().length).toBe(before);
  });

  it("offers a Truncate action", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.getByRole("button", { name: /truncate/i })).toBeInTheDocument();
  });

  it("re-requests with a sort parameter when a column header is clicked", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    fireEvent.click(screen.getByRole("button", { name: /^email$/i }));
    await waitFor(() =>
      expect(calls().some((u) => u.includes("sort=email") || u.includes("orderBy=email"))).toBe(true),
    );
  });

  it("surfaces a fetch failure instead of spinning forever", async () => {
    restore();
    restore = mockFetch({});
    renderIt();
    expect(await screen.findByText(/no route matched|error|failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write the SQL Server test**

`table-detail-client.dom.test.tsx` in the sqlserver tables directory. Note the
prop is `database`, not `db`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";
import { TableDetailClient } from "./table-detail-client";

const DETAIL = {
  columns: [
    { name: "id", dataType: "int", nullable: false, isIdentity: true, defaultDefinition: null, isPrimaryKey: true },
    { name: "email", dataType: "nvarchar(255)", nullable: false, isIdentity: false, defaultDefinition: null, isPrimaryKey: false },
  ],
  indexes: [{ name: "PK_users", isPrimaryKey: true, isUnique: true, columns: ["id"] }],
  constraints: [],
  foreignKeys: [],
};

const DATA = {
  columns: ["id", "email"],
  rows: [
    { id: 1, email: "a@example.com" },
    { id: 2, email: "b@example.com" },
  ],
  total: 2,
};

let restore: () => void;

function calls(): string[] {
  return (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  restore = mockFetch({
    "/data": DATA,
    "/tables/dbo/users": DETAIL,
  });
});

afterEach(() => restore());

function renderIt() {
  return render(
    <TableDetailClient connectionId="c1" database="appdb" schema="dbo" table="users" />,
  );
}

describe("sqlserver TableDetailClient (characterization)", () => {
  it("renders six tabs and no Statistics tab", async () => {
    renderIt();
    for (const label of ["Data", "Structure", "Indexes", "Constraints", "Foreign keys", "DDL"]) {
      expect(await screen.findByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "Statistics" })).toBeNull();
  });

  it("shows row data on the default Data tab", async () => {
    renderIt();
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
  });

  // Phase 2 wires edit/delete up. updateSqlServerRow/deleteSqlServerRow and
  // the rows route already exist; only the UI is missing.
  it("offers insert but no per-row edit or delete today", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.getByRole("button", { name: /insert row/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^delete$/i })).toBeNull();
  });

  // buildClientDdl assembles the DDL in the browser from the detail payload.
  it("renders the DDL tab without any DDL-specific request", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    const before = calls().length;
    fireEvent.click(screen.getByRole("tab", { name: "DDL" }));
    expect(await screen.findByText(/CREATE TABLE/)).toBeInTheDocument();
    expect(calls().length).toBe(before);
  });

  it("renders the column list on the Structure tab", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("tab", { name: "Structure" }));
    expect(await screen.findByText("email")).toBeInTheDocument();
    expect(screen.getByText("nvarchar(255)")).toBeInTheDocument();
  });

  it("surfaces a fetch failure instead of spinning forever", async () => {
    restore();
    restore = mockFetch({});
    renderIt();
    expect(await screen.findByText(/no route matched|error|failed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run and iterate**

Run: `npx vitest run "src/app/{mysql,sqlserver}/**/table-detail-client.dom.test.tsx"`
Same rule as Task 4: adjust the tests, never the components.

- [ ] **Step 4: Commit**

```bash
git add "src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.dom.test.tsx" \
        "src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.dom.test.tsx"
git commit -m "test(mysql,sqlserver): characterize the table detail workspaces

Records today's divergence explicitly — MySQL has no Constraints/FK tabs,
SQL Server has no per-row edit/delete — so Phase 2's convergence shows up as
a deliberate diff to these tests."
```

---

### Task 6: Query-editor characterization tests and Playwright smoke

**Files:**
- Create: `src/app/postgres/[connectionId]/databases/[db]/query/query-editor-client.dom.test.tsx`
- Create: `src/app/mysql/[connectionId]/databases/[db]/query/query-editor-client.dom.test.tsx`
- Create: `src/app/sqlserver/[connectionId]/databases/[db]/query/[queryId]/query-editor-client.dom.test.tsx`
- Create: `e2e/sql-workspaces.spec.ts`

**Interfaces:**
- Consumes: `mockFetch` from `@/test/fetch-mock`; the existing Playwright
  fixtures in `e2e/global-setup.ts`.
- Produces: nothing consumed by later tasks. This is the last task of Phase 1.

- [ ] **Step 1: Write the three query-editor tests**

CodeMirror needs layout APIs happy-dom does not provide, so mock it with a
controlled `<textarea>` in every one of these three files. This is legitimate:
the tests protect the surrounding workspace, not CodeMirror itself.

Here is the postgres file in full. The mysql and sqlserver files are the same
shape with the differences listed in Step 2.

`query-editor-client.dom.test.tsx` in the postgres query directory:

```tsx
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch } from "@/test/fetch-mock";

vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="sql-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

import { QueryEditorClient } from "./query-editor-client";

const OK = {
  results: [
    {
      columns: ["id", "email"],
      rows: [{ id: 1, email: "a@example.com" }],
      rowCount: 1,
      durationMs: 12,
    },
  ],
};

let restore: () => void;

afterEach(() => restore());

function renderIt() {
  return render(<QueryEditorClient connectionId="c1" db="appdb" />);
}

async function run(sql: string) {
  fireEvent.change(screen.getByTestId("sql-editor"), { target: { value: sql } });
  fireEvent.click(screen.getByRole("button", { name: /run|execute/i }));
}

describe("postgres QueryEditorClient (characterization)", () => {
  beforeEach(() => {
    restore = mockFetch({ "/query": OK });
  });

  it("renders the editor and a run control", () => {
    renderIt();
    expect(screen.getByTestId("sql-editor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /run|execute/i })).toBeInTheDocument();
  });

  it("renders the result grid after a successful run", async () => {
    renderIt();
    await run("select 1");
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
  });

  it("shows the row count and duration footer after a run", async () => {
    renderIt();
    await run("select 1");
    expect(await screen.findByText(/1 row/i)).toBeInTheDocument();
    expect(screen.getByText(/12\s*ms/i)).toBeInTheDocument();
  });

  it("renders the error text rather than an empty grid on failure", async () => {
    restore();
    restore = mockFetch({
      "/query": { results: [], error: 'relation "nope" does not exist' },
    });
    renderIt();
    await run("select * from nope");
    expect(await screen.findByText(/does not exist/i)).toBeInTheDocument();
  });

  it("offers an EXPLAIN control", () => {
    renderIt();
    expect(screen.getByRole("button", { name: /explain/i })).toBeInTheDocument();
  });

  it("renders one result panel per statement", async () => {
    restore();
    restore = mockFetch({
      "/query": {
        results: [
          { columns: ["a"], rows: [{ a: 1 }], rowCount: 1, durationMs: 3 },
          { columns: ["b"], rows: [{ b: 2 }], rowCount: 1, durationMs: 4 },
        ],
      },
    });
    renderIt();
    await run("select 1; select 2;");
    await waitFor(() => {
      expect(screen.getByText("a")).toBeInTheDocument();
      expect(screen.getByText("b")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Write the mysql and sqlserver query-editor tests**

Copy the file above into each of the other two directories and change:

**mysql** — props are `{ connectionId, db }`, the mock route is `/query`, and
the multi-statement test stays (MySQL also runs statement lists). Keep the
EXPLAIN assertion.

**sqlserver** — props are `{ connectionId, database, queryId }`; read the
component's `Props` interface to confirm before writing. Replace the EXPLAIN
assertion with the estimated-plan control:

```tsx
it("offers an estimated execution plan control", () => {
  renderIt();
  expect(screen.getByRole("button", { name: /plan/i })).toBeInTheDocument();
});
```

and replace the multi-statement test with `GO` batch splitting:

```tsx
it("renders one result panel per GO batch", async () => {
  restore();
  restore = mockFetch({
    "/query": {
      batches: [
        { columns: ["a"], rows: [{ a: 1 }], rowCount: 1, durationMs: 3 },
        { columns: ["b"], rows: [{ b: 2 }], rowCount: 1, durationMs: 4 },
      ],
    },
  });
  renderIt();
  await run("select 1\nGO\nselect 2\nGO");
  await waitFor(() => {
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });
});
```

The response key differs per tech (`results` vs `batches`) — read each
component's fetch handler and match the real shape rather than trusting these
fixtures.

- [ ] **Step 3: Run and iterate**

Run: `npx vitest run "src/app/**/query-editor-client.dom.test.tsx"`

If a component proves untestable in happy-dom because CodeMirror needs layout
APIs, mock `@uiw/react-codemirror` with a controlled `<textarea>`:

```tsx
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="sql-editor" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));
```

This is legitimate: the tests exist to protect the surrounding workspace, not
CodeMirror itself.

- [ ] **Step 4: Write the Playwright smoke spec**

`e2e/sql-workspaces.spec.ts`. Follow the existing patterns in
`e2e/home.spec.ts` for auth and navigation. For each of postgres, mysql and
sqlserver: create a connection through the home-screen `ConnectionSheet`, open
its workspace, confirm the sidebar renders, open a table, click through every
tab, and confirm no tab shows an error state.

Gate each block on service reachability the way
`services.integration.test.ts` does, and **`console.warn` a visible skip**
rather than passing silently — a green suite that tested nothing is worse than
a red one. MySQL has no compose service yet, so its block will skip until
Phase 2 adds one; say so in the spec's comments.

- [ ] **Step 5: Run the e2e suite**

Run: `docker compose up -d postgres sqlserver && npm run test:e2e`
Expected: postgres and sqlserver blocks run and pass; mysql skips with a
warning. Report which blocks actually ran — a skipped block is not a pass.

- [ ] **Step 6: Full verification**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add "src/app/postgres/[connectionId]/databases/[db]/query/query-editor-client.dom.test.tsx" \
        "src/app/mysql/[connectionId]/databases/[db]/query/query-editor-client.dom.test.tsx" \
        "src/app/sqlserver/[connectionId]/databases/[db]/query/[queryId]/query-editor-client.dom.test.tsx" \
        e2e/sql-workspaces.spec.ts
git commit -m "test(sql): characterize the query editors and add workspace e2e smoke

Completes the safety net for the shared-component refactor. The three SQL
workspaces had zero component tests and no e2e coverage before this."
```

---

## Phase 1 exit criteria

Before Phase 2 is planned, all of these must hold:

- No file in `src/lib/connections/` exceeds ~1200 lines.
- `postgres.barrel.test.ts` and `sqlserver.barrel.test.ts` pass — the public
  surface is provably unchanged.
- Six `*.dom.test.tsx` files cover the three table-detail and three
  query-editor clients.
- `e2e/sql-workspaces.spec.ts` passes for postgres and sqlserver.
- `npm run typecheck && npm run lint && npm test && npm run build` is clean.
- `docker compose up -d postgres sqlserver && npm run test:integration` passes
  with both blocks actually running.

Phase 2 (L1 primitives, L2 shell, L3 convergence, roadmap refresh) is planned
after this lands, once the component tests have made the real shared surface
visible.
