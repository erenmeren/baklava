# SQL Workspace Refactor — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three duplicated SQL table-detail workspaces (Postgres, MySQL, SQL Server) onto one shared shell built from shared primitives, give all three a real error surface, and close the two capability gaps (SQL Server row edit/delete, MySQL constraints/foreign keys).

**Architecture:** Four layers, bottom-up. A **fix wave** first gives all three clients a rendered error surface, so L2's headline promise has a before-state to preserve. **L1** grows `src/components/workspace/` with `ErrorState`, `useTableTabs`, `StructurePanel`, `DdlPanel`, `DataGrid`, `MetaTable`, and one `RowFormDialog`. **L2** introduces `<SqlTableDetail descriptor>` in `src/components/workspace/sql/`, which owns tab state, fetching, error surfaces and refresh-after-mutation; each tech's `table-detail-client.tsx` shrinks to a descriptor plus a fetch adapter. **L3** flips the newly-shared capability flags on for SQL Server rows and adds the missing MySQL introspection, plus the MySQL compose service and seed script that make any of it testable.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui over `@base-ui/react`, vitest + @testing-library/react (`*.dom.test.tsx`), Playwright (`e2e/`), `pg` / `mysql2` / `mssql` drivers.

## Global Constraints

Copied verbatim from `docs/superpowers/specs/2026-08-08-sql-workspace-refactor-design.md` and from the Phase 1 outcome section of `docs/superpowers/plans/2026-08-08-sql-refactor-phase-1.md`.

- **Every branch runs `npm run typecheck && npm run lint && npm test && npm run build`** and all four must be clean before the branch is considered done.
- **The Phase 1 safety net must keep passing unchanged through L1 and L2.** The six characterization suites are:
  `src/app/{postgres,mysql,sqlserver}/.../table-detail-client.dom.test.tsx` and
  `src/app/{postgres,mysql,sqlserver}/.../query-editor-client.dom.test.tsx`.
  L1 and L2 may **not** edit assertions in those files. Four deliberate exceptions are spelled out, each in its own task: Task 3 (removing the MySQL `console.error` allowance once the defect it tolerates is fixed), **Task 6** (narrowing SQL Server's loose `/CREATE TABLE/` DDL matcher to its fixture's actual DDL text — authorised 2026-08-09; Postgres and MySQL already carry this exact narrowing, MySQL with a comment naming the collision, and the shared `DdlPanel`'s header label makes the loose form resolve to two elements; the assertion gets *stronger*, since it stops passing on a substring a header also satisfies), Task 12 (adding SQL Server row-action tests for a capability that did not exist), and Task 13 (adding MySQL constraint/FK tab tests). No other task may touch them.
- **Client components import `@/techs/meta-registry`, never `@/techs/registry`** and never a `<tech>/index.ts` — that pulls Node-only drivers into the client bundle and breaks the build.
- **base-ui, not Radix.** No `asChild`. Use `render={<Comp/>}` on the primitive. A `Button` whose `render` is not a native `<button>` **must** pass `nativeButton={false}` or base-ui logs a dev-mode `console.error`.
- **Every new API route file starts with `export const runtime = "nodejs";`** and wraps thrown errors with `formatError(err)` from `src/lib/errors.ts`.
- **New driver SQL obeys the three rules**: identifiers through `quoteIdent` / `validateIdentifier`, values parameterized, free-form fragments through `requireNoStatementTerminator`.
- **New code imports the specific driver module** (`@/lib/connections/postgres/catalog`), not the barrel.
- **Do not hand-edit `next.config.ts`** — `serverExternalPackages` is generated from each tech module's `serverPackages`.
- **No new npm dependencies.** Every primitive in this plan is built from what is already in `package.json`.

- **PK BADGE COPY — ruling of 2026-08-09.** Sharing `StructurePanel` (Task 6) changed
  MySQL's Structure-tab primary-key badge from `pri` (MySQL's own `SHOW COLUMNS`
  `Key` terminology) to `pk`, because the shared panel was lifted from Postgres and
  the label is a literal in the component rather than a field on `SqlColumn`. No test
  in the repo guards this text — MySQL's characterization suite passes either way, so
  it shipped as a silent side effect of the extraction. **Ruled: standardise on `pk`
  across all three SQL workspaces.** This is now a deliberate convergence decision,
  not an accident: one label everywhere, and no per-caller label override widening a
  primitive the L2 shell is about to build on. Recorded here because the branch's
  binding constraints forbid silent user-visible copy changes — the change stands, but
  it stands on a decision. Add a test so it cannot drift again unnoticed.

- **RETRY WIRING — ruling of 2026-08-09, supersedes Steps 3(d)/3(e) as originally
  written in Tasks 2, 3 and 4.** The original instruction paired "add the whole
  `errors` object to the lazy-tab effect's dependencies" with a Data-tab
  `onRetry` that calls the loader explicitly. Those two are incompatible:
  clearing the error key is a real state change, the effect re-runs, and because
  `pageData` is still `null` after a failure the effect's own
  `tab === "data" && pageData === null && !errors.data` branch fires the loader a
  second time. One Retry click therefore issues **two** requests. Confirmed
  empirically during Task 2's review (fetch count 1 → 3 across one click).
  **The Data tab's `onRetry` must clear the error key ONLY** — no explicit loader
  call — matching how the other tabs already work. Because the effect is then the
  sole caller, its data branch must load the **current page**, not page zero:
  change `loadData(0)` to `loadData(pageOffset)` (SQL Server: `loadData(offset)`).
  On mount that offset is 0, so mount behaviour is unchanged; on retry it
  preserves the page the user was on instead of silently jumping them to the
  first page. Keying the effect on individual `errors.<key>` scalars instead of
  the whole map does **not** fix this — the scalar still changes when the key is
  cleared.

---

## Scope

**In scope:** the table-detail workspace for postgres / mysql / sqlserver, the four workspace tab strips, the row form dialog, the two L3 capability gaps, the MySQL compose service + seed script, and the roadmap/AGENTS refresh.

**Deferred to Phase 3 — stated, not silently dropped.** The design spec puts the query editor in L2 as "a second pass" (`query-editor-client` sharing the CodeMirror setup, result grid, statement-splitter wiring and history strip). It is **not** in this plan. Three reasons: (a) the three query editors are 1086 / 1273 / 734 lines with a different divergence axis from table-detail — editor extensions and history, not fetch strategy — so their descriptor would be a second, unrelated abstraction; (b) this plan is already 14 tasks and 4 branches; (c) the query editor's characterization suite is untouched by everything here, so deferring costs nothing in regression risk. Phase 3 gets its own plan, written after L2 has shown what the real shared surface looks like in practice.

**Also out of scope:** splitting `mysql.ts` (1161 lines — under the 1200 bar and never split in Phase 1), splitting `kafka.ts` (2316 lines, never in scope), and `postgres/ops.ts` (1193 lines, Phase 1 carried item 6 — a natural cleanup but unrelated to the SQL workspace and better done on its own branch).

### Sequencing change from the design spec — read this before starting

The spec's branch order is L1 → L2 → L3 → docs, and it puts the shared error surface inside L2. This plan puts a **fix wave before L1** (Branch A, Tasks 1–4) that gives each of the three clients its own error surface first, and only then consolidates.

Why: Phase 1's review found that all three table-detail components mishandle fetch failure (no `.catch()`, no error branch in the render tree — only skeletons), and that **each of the three characterization suites had to delete its "surfaces a fetch failure" test because the behaviour does not exist**. If the error surface is born inside L2, then L2 simultaneously introduces new behaviour and moves 3,400 lines of existing behaviour, with no test that can tell the two apart. Building the behaviour first, per-tech, with its own tests, means L2 becomes a pure consolidation that those same tests police. This is the same reasoning that made Phase 1's L0 provable.

---

## File Structure

**New files.**

| Path | Responsibility |
|---|---|
| `src/components/workspace/error-state.tsx` | The one error surface. `role="alert"` + `text-destructive`, optional Retry. |
| `src/components/workspace/error-state.dom.test.tsx` | Unit tests for the above. |
| `src/components/workspace/use-table-tabs.ts` | localStorage-backed tab-strip state: hydrate, persist, auto-add active, close-with-fallback. |
| `src/components/workspace/use-table-tabs.dom.test.tsx` | Unit tests for the above. |
| `src/components/workspace/sql/types.ts` | `SqlColumn` — the normalized column model the shared panels read. |
| `src/components/workspace/sql/structure-panel.tsx` | The columns table (three private copies today). |
| `src/components/workspace/sql/ddl-panel.tsx` | The DDL `<pre>` + copy button (three copies today). |
| `src/components/workspace/sql/data-grid.tsx` | Row grid + `GridToolbar` + pure `filterRows`. |
| `src/components/workspace/sql/data-grid.dom.test.tsx` | Unit tests for the above. |
| `src/components/workspace/sql/meta-table.tsx` | Generic metadata table over shadcn `Table` (indexes / constraints / FKs). |
| `src/components/workspace/sql/row-form-dialog.tsx` | One row form, `tint` + pluggable type detection, replacing three copies. |
| `src/components/workspace/sql/sql-table-detail.tsx` | L2 shell: `<SqlTableDetail descriptor ctx>`. |
| `src/components/workspace/sql/descriptor.ts` | `SqlTableDetailDescriptor` type + `TableTab` union. |
| `src/app/postgres/.../tables/[table]/stats-grid.tsx` | Postgres-only Statistics panel, extracted from the client in Task 10. |
| `src/lib/connections/mysql-constraints.ts` | `listConstraints` / `listForeignKeys` for MySQL (kept out of the 1161-line `mysql.ts`). |
| `src/app/api/mysql/[id]/databases/[db]/tables/[table]/constraints/route.ts` | GET constraints + FKs. |
| `seed/mysql.sh` | MySQL demo data mirroring `seed/postgres.sh`. |

**Modified files.**

| Path | Change |
|---|---|
| `src/test/fetch-mock.ts` | Let a route return a `Response` (non-200) or throw (network failure). |
| `src/app/postgres/.../table-detail-client.tsx` | Task 2 error surface → Task 9 shrink to descriptor. |
| `src/app/mysql/.../table-detail-client.tsx` | Task 3 error surface + `nativeButton` → Task 10 shrink. |
| `src/app/sqlserver/.../table-detail-client.tsx` | Task 4 error surface → Task 10 shrink + Task 11 row actions. |
| `src/app/{postgres,mysql,sqlserver,mongo}/[connectionId]/*-tabs.tsx` | Task 5: use `useTableTabs`. |
| `src/app/{postgres,mysql,sqlserver}/.../row-form-dialog.tsx` | Task 9 (L1): deleted, replaced by the shared one. |
| `compose.yaml`, `seed/all.sh`, `src/lib/connections/services.integration.test.ts`, `e2e/sql-workspaces.spec.ts` | Task 13: MySQL service, seed, integration + e2e coverage. |
| `docs/ROADMAP.md`, `AGENTS.md` | Task 14. |

---

## Task 0: Preflight — run the integration and e2e suites against real services

Phase 1 carried items 3 and 4: `npm run test:integration` has **never** run (Docker was unreachable) and `e2e/sql-workspaces.spec.ts` has never run against live services — its navigation is source-traced only. Task 1 is the first behaviour-changing commit of Phase 2, so this gate comes first.

**Files:**
- Modify (only if the run reveals defects): `e2e/sql-workspaces.spec.ts`

- [ ] **Step 1: Bring the stack up and seed it**

```bash
docker compose up -d postgres sqlserver
docker compose ps          # both healthy before continuing
bash seed/postgres.sh
bash seed/sqlserver.sh
```

If the Docker daemon is unreachable on this machine, **stop and report it**. Do not proceed to Task 1 by declaring this task skipped — the whole point of the gate is that Phase 2 changes behaviour. Hand back to the human with the exact `docker info` error.

- [ ] **Step 2: Run the integration suite**

Run: `npm run test:integration`
Expected: PASS, with the postgres and sqlserver blocks **actually running** (not skipped). Confirm by checking there is no `[skip] postgres not reachable` / `[skip] sqlserver not reachable` warning in the output.

- [ ] **Step 3: Run the SQL workspace e2e spec**

Run: `npm run dev` in one shell, then in another: `npx playwright test e2e/sql-workspaces.spec.ts --reporter=list`
Expected: the postgres and sqlserver blocks run and pass. The mysql block reports as fixme.

- [ ] **Step 4: Fix any selector drift the real run exposes, then re-run**

The Phase 1 outcome explicitly predicts "expect to fix selectors on first real run". Fix what breaks in `e2e/sql-workspaces.spec.ts` only — do not change application code to satisfy a test selector. Re-run Step 3 until green.

- [ ] **Step 5: Commit (skip if nothing changed)**

```bash
git checkout -b test/e2e-first-real-run
git add e2e/sql-workspaces.spec.ts
git commit -m "test(e2e): correct sql-workspaces selectors against live services"
```

- [ ] **Step 6: Record the baseline in the task report**

Write down, verbatim, the integration suite's pass count and the e2e pass count. Every later task compares against these numbers.

---

# Branch A — `fix/sql-table-detail-error-surface`

## Task 1: `ErrorState` primitive + `fetch` mock error support

**Files:**
- Create: `src/components/workspace/error-state.tsx`
- Create: `src/components/workspace/error-state.dom.test.tsx`
- Modify: `src/test/fetch-mock.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }): React.ReactElement` from `@/components/workspace/error-state`
  - `httpError(status: number, message: string): () => Response` and `netFail(message?: string): () => never` from `@/test/fetch-mock`

**Why `role="alert"` + `text-destructive` specifically:** `e2e/sql-workspaces.spec.ts`'s `clickThroughTabs` asserts `page.locator('[role="alert"].text-destructive')` has count 0 and that no text matches `/could not load|failed/i`. Those assertions were written against a DOM that never emits an error banner. Making `ErrorState` match both makes the e2e assertion actually load-bearing from Task 2 onward.

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/error-state.dom.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  it("renders as an alert carrying the destructive class the e2e spec matches on", () => {
    const { container } = render(
      <ErrorState title="Could not load data" message="connection refused" />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    // e2e/sql-workspaces.spec.ts matches '[role="alert"].text-destructive'.
    expect(container.querySelector('[role="alert"].text-destructive')).not.toBeNull();
  });

  it("shows both the title and the underlying driver message", () => {
    render(<ErrorState title="Could not load data" message="ECONNREFUSED 127.0.0.1:5432" />);
    expect(screen.getByText("Could not load data")).toBeInTheDocument();
    expect(screen.getByText("ECONNREFUSED 127.0.0.1:5432")).toBeInTheDocument();
  });

  it("renders no Retry button when no handler is given", () => {
    render(<ErrorState title="Could not load data" message="boom" />);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("calls onRetry when Retry is clicked", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Could not load data" message="boom" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/error-state.dom.test.tsx`
Expected: FAIL — `Failed to resolve import "./error-state"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/workspace/error-state.tsx`:

```tsx
"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one rendered error surface for workspace panels.
 *
 * Before this existed, a failed fetch in a table-detail tab produced either a
 * toast that vanished or an unhandled promise rejection, and the panel sat on
 * its loading skeleton forever. `role="alert"` plus the `text-destructive`
 * class token are both load-bearing: e2e/sql-workspaces.spec.ts asserts on
 * exactly that selector when it clicks through every tab.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="size-4 mt-px shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{title}</div>
          <div className="mt-0.5 text-[11.5px] font-mono break-words text-destructive/85">
            {message}
          </div>
        </div>
        {onRetry ? (
          <Button size="xs" variant="outline" onClick={onRetry} className="shrink-0">
            <RotateCw className="size-3" />
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/workspace/error-state.dom.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Extend the fetch mock so a route can fail**

`mockFetch` today wraps every payload in a 200 `Response`, so no test can express "the server returned 502" or "the socket died". Add both.

In `src/test/fetch-mock.ts`, change the body-resolution line inside the stub from:

```ts
    const body = typeof payload === "function" ? (payload as (u: string) => unknown)(url) : payload;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
```

to:

```ts
    const body = typeof payload === "function" ? (payload as (u: string) => unknown)(url) : payload;
    // A route may hand back a fully-formed Response to model a non-200 reply.
    // Always produce it from a *function* payload (see httpError) — a Response
    // body can only be read once, so a shared instance breaks on the second
    // request to the same route.
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
```

Then append to the same file:

```ts
/**
 * Route payload modelling an HTTP error reply, in the `{ error }` shape every
 * Baklava API route uses via `errorResponse` / `formatError`.
 *
 *   mockFetch({ "view=data": httpError(502, "ECONNREFUSED 127.0.0.1:5432") })
 */
export function httpError(status: number, message: string): () => Response {
  return () =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
}

/**
 * Route payload modelling a transport-level failure — the promise returned by
 * `fetch` rejects, as it does for a dropped socket or DNS failure. This is the
 * case that produced unhandled promise rejections before Phase 2.
 */
export function netFail(message = "Failed to fetch"): () => never {
  return () => {
    throw new TypeError(message);
  };
}
```

- [ ] **Step 6: Verify the mock changes did not disturb the Phase 1 safety net**

Run: `npx vitest run src/app/postgres src/app/mysql src/app/sqlserver`
Expected: PASS, same test count as before the change (the six characterization suites, 34 tests).

- [ ] **Step 7: Commit**

```bash
git checkout -b fix/sql-table-detail-error-surface
git add src/components/workspace/error-state.tsx \
        src/components/workspace/error-state.dom.test.tsx \
        src/test/fetch-mock.ts
git commit -m "feat(workspace): add ErrorState primitive and failing-route support in the fetch mock"
```

---

## Task 2: Postgres table detail surfaces fetch failures

Today: `loadData` has no `.catch()` and is fired from a mount effect, so a rejected fetch is an unhandled rejection; a non-ok response calls `toast.error` and leaves `pageData === null`, so the Data tab shows skeletons forever. The per-tab loaders (`structure`, `indexes`, `constraints`, `foreign_keys`) swallow with `.catch(() => undefined)`; `ddl` and `stats` toast and then also sit on skeletons.

**Files:**
- Modify: `src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/table-detail-client.tsx`
- Test: `src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/table-detail-client.dom.test.tsx`

**Interfaces:**
- Consumes: `ErrorState` from `@/components/workspace/error-state`; `httpError`, `netFail` from `@/test/fetch-mock` (Task 1).
- Produces: no exported surface change — `TableDetailClient` keeps its `{ connectionId, db, schema, table }` props.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe("postgres TableDetailClient (characterization)")` block in `table-detail-client.dom.test.tsx`, and **delete the 8-line comment block above it** (lines beginning `// No "surfaces a fetch failure instead of spinning forever" test here`) — it documents an absence this task removes.

Add `httpError, netFail` to the existing `@/test/fetch-mock` import. These two tests build their own route map, so they must override the `beforeEach` mock; call the outer `restore()` first.

```tsx
  it("renders an error state when the data view returns a non-200", async () => {
    restore(); // drop the all-green mock installed in beforeEach
    restore = mockFetch({
      "view=structure": { columns: COLUMNS },
      "view=data": httpError(502, "ECONNREFUSED 127.0.0.1:5432"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(screen.getByText(/ECONNREFUSED 127\.0\.0\.1:5432/)).toBeInTheDocument();
    // The skeletons are gone — this is what "instead of spinning forever" means.
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBe(0);
  });

  it("renders an error state when the data fetch rejects at the transport layer", async () => {
    restore();
    restore = mockFetch({
      "view=structure": { columns: COLUMNS },
      "view=data": netFail("Failed to fetch"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument();
  });

  it("retries the failed view when Retry is clicked", async () => {
    restore();
    let attempt = 0;
    restore = mockFetch({
      "view=structure": { columns: COLUMNS },
      "view=data": () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return ROWS;
      },
    });
    renderIt();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
```

`restore` is already declared as `let restore: () => void` at module scope in this file, so reassigning it keeps `afterEach(() => restore())` correct.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/table-detail-client.dom.test.tsx"`
Expected: FAIL — all three, with `Unable to find role="alert"`. Confirm the first two also print an unhandled-rejection or a lingering skeleton, which is the defect being fixed.

- [ ] **Step 3: Add per-view error state to the component**

In `table-detail-client.tsx`:

(a) Add the import and a single error map beside the existing state:

```tsx
import { ErrorState } from "@/components/workspace/error-state";
```

```tsx
  type ViewKey = "data" | "structure" | "indexes" | "constraints" | "foreign_keys" | "ddl" | "stats";
  const [errors, setErrors] = useState<Partial<Record<ViewKey, string>>>({});
  const clearError = useCallback((view: ViewKey) => {
    setErrors((prev) => {
      if (!(view in prev)) return prev;
      const next = { ...prev };
      delete next[view];
      return next;
    });
  }, []);
```

(b) Make `fetchView` record instead of only toasting:

```tsx
  const fetchView = useCallback(
    async (
      view: "structure" | "indexes" | "constraints" | "foreign_keys"
    ): Promise<unknown> => {
      try {
        const res = await fetch(`${base}?view=${view}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        clearError(view);
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrors((prev) => ({ ...prev, [view]: message }));
        throw err;
      }
    },
    [base, clearError]
  );
```

(c) Give `loadData` the `.catch` it never had:

```tsx
  const loadData = useCallback(
    async (offset: number, limit: number = pageLimit) => {
      setLoadingData(true);
      try {
        const res = await fetch(
          `${base}?view=data&limit=${limit}&offset=${offset}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        setPageData(data as TableData);
        clearError("data");
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          data: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setLoadingData(false);
      }
    },
    [base, pageLimit, clearError]
  );
```

(d) The lazy-tab effect currently re-fires forever on a failed view, because its guard is `x === null` and a failure leaves it null. Guard on the error map too — change each branch's condition from e.g. `tab === "indexes" && indexes === null` to `tab === "indexes" && indexes === null && !errors.indexes`, for all seven branches, and add `errors` to the effect's dependency array. Do the same for the mount effect that loads `structure` (`columns === null && !errors.structure`).

For the two branches that hand-roll their fetch (`ddl`, `stats`), replace the `.catch(err => toast.error(...))` tail with:

```tsx
        .catch((err) => {
          setErrors((prev) => ({
            ...prev,
            ddl: err instanceof Error ? err.message : String(err),
          }));
        });
```

(and the `stats` equivalent, keyed `stats`).

(e) Render the error. In each `TabsContent`, put the error branch **first**, ahead of the skeleton branch. Data tab:

```tsx
          {errors.data ? (
            <ErrorState
              title="Could not load data"
              message={errors.data}
              onRetry={() => clearError("data")}
            />
          ) : pageData ? (
```

…and close the extra ternary at the existing skeleton branch. Repeat for the other six panels with these titles, each `onRetry` clearing the key and nulling the corresponding state so the lazy effect refires:

| tab | title | retry action |
|---|---|---|
| `structure` | `Could not load structure` | `clearError("structure"); setColumns(null);` |
| `indexes` | `Could not load indexes` | `clearError("indexes"); setIndexes(null);` |
| `constraints` | `Could not load constraints` | `clearError("constraints"); setConstraints(null);` |
| `foreign_keys` | `Could not load foreign keys` | `clearError("foreign_keys"); setForeignKeys(null);` |
| `ddl` | `Could not load DDL` | `clearError("ddl"); setDdl(null);` |
| `stats` | `Could not load statistics` | `clearError("stats"); setStats(null);` |

(f) Reset `errors` in the existing `useEffect` that resets all state on `[base]`: add `setErrors({});`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/table-detail-client.dom.test.tsx"`
Expected: PASS — 8 tests (5 pre-existing + 3 new), no unhandled rejections in the output.

- [ ] **Step 5: Commit**

```bash
git add "src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/"
git commit -m "fix(postgres): render a real error state when a table-detail view fails"
```

---

## Task 3: MySQL table detail surfaces fetch failures, and stops warning on mount

Two defects, same file. The fetch-failure defect is the same one as Task 2 (`loadData` has no `.catch()`, `loadMeta` catches but only toasts). The second is Phase 1 carried item 5: `<Button render={<a href=…/>}>` at `table-detail-client.tsx:350-362` lacks `nativeButton={false}`, so base-ui logs a `console.error` on **every** mount; the characterization suite tolerates exactly that one message. Fixing the component means the allowance must go, or the suite stops proving anything about that warning.

**Files:**
- Modify: `src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.tsx`
- Test: `src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.dom.test.tsx`

**Interfaces:**
- Consumes: `ErrorState`, `httpError`, `netFail`.
- Produces: no exported surface change.

- [ ] **Step 1: Write the failing tests**

In the test file, replace the `KNOWN_WARNING` allowance block (the `const KNOWN_WARNING = …` line through the `afterEach(() => consoleErrorSpy.mockRestore());` line, plus its 10-line explanatory comment) with a strict spy:

```tsx
// The component renders `<Button render={<a href=… />} nativeButton={false}>`
// for its "Open query" action, so base-ui logs nothing. Any console.error at
// all is a failure — vitest only prints captured console output for failing
// tests, so a plain "did anything log?" check would miss a regression here.
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
    throw new Error(`Unexpected console.error: ${String(args[0])}`);
  });
});
afterEach(() => consoleErrorSpy.mockRestore());
```

Add `httpError, netFail` to the `@/test/fetch-mock` import, and append to the describe block (adapt the fixture names to the ones this file already declares — `COLUMNS`, and whatever it calls the rows fixture; read the file, do not guess):

```tsx
  it("renders an error state when the rows request returns a non-200", async () => {
    restore();
    restore = mockFetch({
      "/tables/users$": { columns: COLUMNS, indexes: [], ddl: "", primaryKey: ["id"] },
      "/rows": httpError(502, "ER_ACCESS_DENIED_ERROR: access denied"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
    expect(screen.getByText(/ER_ACCESS_DENIED_ERROR/)).toBeInTheDocument();
  });

  it("renders an error state when the meta request rejects at the transport layer", async () => {
    restore();
    restore = mockFetch({
      "/tables/users$": netFail("Failed to fetch"),
      "/rows": netFail("Failed to fetch"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
```

Note the `"$"` anchor on the base-resource pattern — `mockFetch` throws on an ambiguous match, and `/rows` URLs contain the base URL as a literal prefix.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.dom.test.tsx"`
Expected: FAIL — the two new tests can't find `role="alert"`, **and** every pre-existing test in the file now fails with `Unexpected console.error: … expected a native <button>`. Both failures are the point.

- [ ] **Step 3: Fix the button and add the error state**

(a) At the "Open query" action, add the prop:

```tsx
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={
              <a
                href={`/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query`}
              />
            }
            title="Open a SQL query editor for this database"
          >
```

(b) Add `import { ErrorState } from "@/components/workspace/error-state";` and the error map, exactly as in Task 2 but with this component's tab keys:

```tsx
  type ViewKey = "data" | "meta";
  const [errors, setErrors] = useState<Partial<Record<ViewKey, string>>>({});
  const clearError = useCallback((view: ViewKey) => {
    setErrors((prev) => {
      if (!(view in prev)) return prev;
      const next = { ...prev };
      delete next[view];
      return next;
    });
  }, []);
```

MySQL loads all metadata in one request, so `meta` covers the Structure / Indexes / DDL tabs and `data` covers the Data tab.

(c) In `loadMeta`, replace the toast-only catch with `setErrors((prev) => ({ ...prev, meta: message }))` (keep the existing `AbortError` guard — an aborted request is not an error), and `clearError("meta")` on success. Gate the mount effect on `meta === null && !errors.meta`.

(d) In `loadData`, wrap the body in `try/catch` exactly as Task 2 does, keyed `data`, and gate the lazy effect on `pageData === null && !errors.data`.

(e) Render `<ErrorState>` first in each panel: Data tab uses `errors.data` with title `Could not load data` and `onRetry={() => { clearError("data"); loadData(pageOffset); }}`; Structure, Indexes and DDL each use `errors.meta` with titles `Could not load structure` / `Could not load indexes` / `Could not load DDL` and `onRetry={() => { clearError("meta"); setMeta(null); }}`.

(f) Add `setErrors({})` to the existing reset-on-`[base]` effect.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.dom.test.tsx"`
Expected: PASS — all tests, with zero tolerated `console.error`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/mysql/[connectionId]/databases/[db]/tables/[table]/"
git commit -m "fix(mysql): render a real error state on table-detail failures; silence the base-ui button warning"
```

---

## Task 4: SQL Server table detail surfaces fetch failures

Same defect, third copy: `loadDetail` has no `.catch()` and is fired from a mount effect, so a dead connection is an unhandled rejection. This client is the `single`-strategy one — one request fills every tab except Data.

**Files:**
- Modify: `src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.tsx`
- Test: `src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.dom.test.tsx`

**Interfaces:**
- Consumes: `ErrorState`, `httpError`, `netFail`.
- Produces: no exported surface change.

- [ ] **Step 1: Write the failing tests**

Add `httpError, netFail` to the `@/test/fetch-mock` import and append to the describe block (use the file's existing `DETAIL` fixture and its `restore` binding):

```tsx
  it("renders an error state when the detail request returns a non-200", async () => {
    restore();
    restore = mockFetch({
      "/tables/dbo/users$": httpError(502, "Login failed for user 'sa'."),
      "/data": { fields: [], rows: [], total: 0 },
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load table/i);
    expect(screen.getByText(/Login failed for user/)).toBeInTheDocument();
  });

  it("renders an error state when the data request rejects at the transport layer", async () => {
    restore();
    restore = mockFetch({
      "/tables/dbo/users$": DETAIL,
      "/data": netFail("Failed to fetch"),
    });
    renderIt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load data/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.dom.test.tsx"`
Expected: FAIL — no `role="alert"`.

- [ ] **Step 3: Add the error state**

Add `import { ErrorState } from "@/components/workspace/error-state";` and:

```tsx
  const [detailError, setDetailError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
```

Rewrite the two loaders:

```tsx
  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
      setDetail(d as Detail);
      setDetailError(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
      setDetail(null);
    }
  }, [base]);

  const loadData = useCallback(
    async (off: number, limit: number = pageSize) => {
      setLoadingData(true);
      try {
        const res = await fetch(`${base}/data?offset=${off}&limit=${limit}`, {
          cache: "no-store",
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `Request failed (${res.status})`);
        setData(d as TableData);
        setDataError(null);
      } catch (err) {
        setDataError(err instanceof Error ? err.message : String(err));
        // Null the cached rows so Retry can re-satisfy the effect's guard.
        // Without this, a failure that follows a success leaves `data`
        // non-null, clearing the error alone never re-opens the guard, and
        // Retry is a dead button. Postgres and MySQL both hit this.
        setData(null);
      } finally {
        setLoadingData(false);
      }
    },
    [base, pageSize],
  );
```

Gate the two mount effects so a failure doesn't loop: `useEffect(() => { if (!detail && !detailError) void loadDetail(); }, [detail, detailError, loadDetail])` and `if (tab === "data" && !data && !dataError) void loadData(offset)`. Note `loadData(offset)`, **not** `loadData(0)` — per the retry ruling in Global Constraints, this effect is the sole loader on the retry path, so it must restore the page the user was on. Add `offset` to that effect's dependency array and confirm it cannot loop during pagination.

Render, error-branch-first: the Data panel uses `dataError` → `<ErrorState title="Could not load data" message={dataError} onRetry={() => setDataError(null)} />`; the Structure / Indexes / Constraints / Foreign keys / DDL panels each use `detailError` → `<ErrorState title="Could not load table" message={detailError} onRetry={() => setDetailError(null)} />`.

**Both** handlers clear their error and nothing else. SQL Server is the one tech where the retry ruling bites twice: its `detail` path has the same shape as its `data` path — an explicit loader call in `onRetry` alongside a mount effect gated on `!detail && !detailError` — so an explicit call there would double-fire exactly as the Data tab did in Postgres and MySQL. Clearing the error re-opens each guard, and the effect is the only caller.

The header `description` also reads `detail.rowCount` — when `detail` is null it already falls back to `database {database}`, so no change is needed there.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.dom.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the branch gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all clean. Test count is the Phase 1 baseline (852) plus the 11 tests added in Tasks 1–4.

- [ ] **Step 6: Commit**

```bash
git add "src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/"
git commit -m "fix(sqlserver): render a real error state on table-detail failures"
```

**Branch A is complete.** Merge to `main` before starting Branch B — every later task assumes the error surface exists.

---

# Branch B — `refactor/sql-ui-primitives` (L1)

## Task 5: `useTableTabs` hook, and all four tab strips on it

`postgres-tabs.tsx` (477), `mysql-tabs.tsx` (420), `sqlserver-tabs.tsx` (422) and `mongo-tabs.tsx` (335) each carry their own copy of: the storage key, `loadTabs` / `saveTabs`, the `hydrated` flag, hydrate-once, persist-on-change, auto-add-active, and `closeTab` with index-based fallback navigation. Only the `Tab` union, `tabKey`, `tabHref`, `tabLabel`, `tabFromPath` and the icon mapping genuinely differ.

**Files:**
- Create: `src/components/workspace/use-table-tabs.ts`
- Create: `src/components/workspace/use-table-tabs.dom.test.tsx`
- Modify: `src/app/postgres/[connectionId]/postgres-tabs.tsx`
- Modify: `src/app/mysql/[connectionId]/mysql-tabs.tsx`
- Modify: `src/app/sqlserver/[connectionId]/sqlserver-tabs.tsx`
- Modify: `src/app/mongo/[connectionId]/mongo-tabs.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, from `@/components/workspace/use-table-tabs`:

```ts
export interface UseTableTabsOptions<T> {
  storageKey: string;
  activeTab: T | null;
  key: (tab: T) => string;
  href: (tab: T) => string;
  homeHref: string;
  /** Adjust a tab as it is auto-added — postgres/mysql/sqlserver number query tabs here. */
  onAdd?: (tab: T, existing: T[]) => T;
}
export interface UseTableTabsResult<T> {
  tabs: T[];
  setTabs: React.Dispatch<React.SetStateAction<T[]>>;
  hydrated: boolean;
  activeKey: string | null;
  closeTab: (key: string) => void;
}
export function useTableTabs<T>(options: UseTableTabsOptions<T>): UseTableTabsResult<T>;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/use-table-tabs.dom.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTableTabs } from "./use-table-tabs";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

type Tab = { kind: "table"; name: string };
const key = (t: Tab) => `t:${t.name}`;
const href = (t: Tab) => `/pg/c1/tables/${t.name}`;

const STORAGE_KEY = "baklava:test-tabs:c1";

beforeEach(() => {
  window.localStorage.clear();
  push.mockClear();
});

function setup(activeTab: Tab | null) {
  return renderHook(() =>
    useTableTabs<Tab>({
      storageKey: STORAGE_KEY,
      activeTab,
      key,
      href,
      homeHref: "/pg/c1",
    }),
  );
}

describe("useTableTabs", () => {
  it("hydrates from localStorage and reports hydrated", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ kind: "table", name: "users" }]),
    );
    const { result } = setup(null);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.tabs).toEqual([{ kind: "table", name: "users" }]);
  });

  it("starts empty when the stored value is corrupt rather than throwing", async () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    const { result } = setup(null);
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.tabs).toEqual([]);
  });

  it("auto-adds the active tab and persists it", async () => {
    const { result } = setup({ kind: "table", name: "orders" });
    await waitFor(() =>
      expect(result.current.tabs).toEqual([{ kind: "table", name: "orders" }]),
    );
    expect(result.current.activeKey).toBe("t:orders");
    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([
        { kind: "table", name: "orders" },
      ]),
    );
  });

  it("does not add the active tab twice", async () => {
    const { result, rerender } = setup({ kind: "table", name: "orders" });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    rerender();
    expect(result.current.tabs).toHaveLength(1);
  });

  it("closing the active tab navigates to the previous one", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { kind: "table", name: "users" },
        { kind: "table", name: "orders" },
      ]),
    );
    const { result } = setup({ kind: "table", name: "orders" });
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    act(() => result.current.closeTab("t:orders"));
    expect(result.current.tabs).toEqual([{ kind: "table", name: "users" }]);
    expect(push).toHaveBeenCalledWith("/pg/c1/tables/users");
  });

  it("closing the last tab navigates home", async () => {
    const { result } = setup({ kind: "table", name: "orders" });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    act(() => result.current.closeTab("t:orders"));
    expect(push).toHaveBeenCalledWith("/pg/c1");
  });

  it("closing a background tab does not navigate", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { kind: "table", name: "users" },
        { kind: "table", name: "orders" },
      ]),
    );
    const { result } = setup({ kind: "table", name: "orders" });
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    act(() => result.current.closeTab("t:users"));
    expect(push).not.toHaveBeenCalled();
    expect(result.current.tabs).toEqual([{ kind: "table", name: "orders" }]);
  });

  it("passes new tabs through onAdd so callers can number them", async () => {
    const { result } = renderHook(() =>
      useTableTabs<Tab>({
        storageKey: STORAGE_KEY,
        activeTab: { kind: "table", name: "" },
        key: (t) => `t:${t.name}`,
        href,
        homeHref: "/pg/c1",
        onAdd: (tab, existing) => ({ ...tab, name: `query ${existing.length + 1}` }),
      }),
    );
    await waitFor(() =>
      expect(result.current.tabs).toEqual([{ kind: "table", name: "query 1" }]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/use-table-tabs.dom.test.tsx`
Expected: FAIL — `Failed to resolve import "./use-table-tabs"`.

- [ ] **Step 3: Write the hook**

Create `src/components/workspace/use-table-tabs.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * localStorage-backed workspace tab-strip state, shared by the postgres,
 * mysql, sqlserver and mongo strips. Everything tech-specific — the tab
 * union, its key/href/label, and how a path maps to a tab — stays with the
 * caller; this owns only the parts that were identical in all four copies.
 *
 * The `hydrated` flag is load-bearing twice over: the strip renders a blank
 * placeholder until it flips (so SSR and the first client render agree), and
 * the persist effect is gated on it (so the empty initial state never
 * overwrites what is in storage).
 */
export interface UseTableTabsOptions<T> {
  /** Full localStorage key, e.g. `baklava:pg-tabs:${connectionId}`. */
  storageKey: string;
  /** The tab the current route maps to, or null if the route isn't a tab. */
  activeTab: T | null;
  key: (tab: T) => string;
  href: (tab: T) => string;
  /** Where to go when the last tab is closed. */
  homeHref: string;
  /** Adjust a tab as it is auto-added (used to number query tabs). */
  onAdd?: (tab: T, existing: T[]) => T;
}

export interface UseTableTabsResult<T> {
  tabs: T[];
  setTabs: React.Dispatch<React.SetStateAction<T[]>>;
  hydrated: boolean;
  activeKey: string | null;
  closeTab: (key: string) => void;
}

function load<T>(storageKey: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function save<T>(storageKey: string, tabs: T[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(tabs));
  } catch {
    // Quota or private-mode failures are not worth breaking navigation over.
  }
}

export function useTableTabs<T>({
  storageKey,
  activeTab,
  key,
  href,
  homeHref,
  onAdd,
}: UseTableTabsOptions<T>): UseTableTabsResult<T> {
  const router = useRouter();
  const [tabs, setTabs] = useState<T[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTabs(load<T>(storageKey));
    setHydrated(true);
  }, [storageKey]);

  useEffect(() => {
    if (hydrated) save(storageKey, tabs);
  }, [tabs, hydrated, storageKey]);

  // `key` / `href` / `onAdd` arrive as inline arrows at every call site, so
  // they have a fresh identity on every render. Putting them in a dep array
  // would re-run the auto-add effect and rebuild `closeTab` continuously;
  // suppressing exhaustive-deps instead would leave a stale-closure trap and
  // a lint suppression a reviewer would rightly flag. Hold the latest
  // callbacks in a ref and read them at call time — the standard
  // latest-callback pattern, and the effects then depend only on real data.
  const cbs = useRef({ key, href, onAdd });
  cbs.current = { key, href, onAdd };

  const activeKey = activeTab ? key(activeTab) : null;

  useEffect(() => {
    if (!hydrated || !activeTab) return;
    const { key: keyOf, onAdd: decorate } = cbs.current;
    setTabs((prev) => {
      const k = keyOf(activeTab);
      if (prev.some((t) => keyOf(t) === k)) return prev;
      return [...prev, decorate ? decorate(activeTab, prev) : activeTab];
    });
  }, [activeTab, hydrated]);

  const closeTab = useCallback(
    (target: string) => {
      const { key: keyOf, href: hrefOf } = cbs.current;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => keyOf(t) === target);
        if (idx < 0) return prev;
        const next = prev.filter((_, i) => i !== idx);
        if (target === activeKey) {
          const fallback = next[idx - 1] ?? next[idx] ?? null;
          router.push(fallback ? hrefOf(fallback) : homeHref);
        }
        return next;
      });
    },
    [activeKey, router, homeHref],
  );

  return { tabs, setTabs, hydrated, activeKey, closeTab };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/workspace/use-table-tabs.dom.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Migrate `postgres-tabs.tsx`**

Delete `storageKey`, `loadTabs`, `saveTabs`, the `tabs` / `hydrated` state, the three effects and `closeTab` from the component; keep `tabKey`, `tabHref`, `tabLabel`, `tabFromPath`, the rename state and the `Tab` sub-component untouched. Replace with:

```tsx
  const { tabs, setTabs, hydrated, activeKey, closeTab } = useTableTabs<Tab>({
    storageKey: `baklava:pg-tabs:${connectionId}`,
    activeTab,
    key: tabKey,
    href: (t) => tabHref(connectionId, t),
    homeHref: `/postgres/${connectionId}`,
    onAdd: (tab, existing) =>
      tab.kind === "query"
        ? { ...tab, title: `query ${existing.filter((t) => t.kind === "query").length + 1}` }
        : tab,
  });
```

`setTabs` stays in use by `commitRename`. The `if (!hydrated) return <placeholder/>` early return stays exactly as-is.

- [ ] **Step 6: Migrate the other three strips the same way**

- `mysql-tabs.tsx` — storage key `baklava:mysql-tabs:${connectionId}`, home `/mysql/${connectionId}`, same query-numbering `onAdd`.
- `sqlserver-tabs.tsx` — storage key `baklava:mssql-tabs:${connectionId}`, home `/sqlserver/${connectionId}`, same `onAdd`.
- `mongo-tabs.tsx` — storage key `baklava:mongo-tabs:${connectionId}`, home `/mongo/${connectionId}`, **no** `onAdd` (it has no query tabs and no rename state).

Read each file's existing `storageKey()` function and copy the string verbatim — the exact keys are user-visible state and changing one silently wipes people's open tabs. If a key differs from the guesses above, the file wins.

- [ ] **Step 7: Verify nothing regressed**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean. The four strips have no characterization tests of their own — the hook's 8 tests plus `typecheck` are the safety net, which is why the storage keys had to be copied rather than reconstructed.

- [ ] **Step 8: Commit**

```bash
git checkout -b refactor/sql-ui-primitives
git add src/components/workspace/use-table-tabs.ts \
        src/components/workspace/use-table-tabs.dom.test.tsx \
        "src/app/postgres/[connectionId]/postgres-tabs.tsx" \
        "src/app/mysql/[connectionId]/mysql-tabs.tsx" \
        "src/app/sqlserver/[connectionId]/sqlserver-tabs.tsx" \
        "src/app/mongo/[connectionId]/mongo-tabs.tsx"
git commit -m "refactor(workspace): extract useTableTabs and put all four tab strips on it"
```

---

## Task 6: `SqlColumn` model, `StructurePanel` and `DdlPanel`

The Postgres and MySQL Structure tabs are near-identical 230-line private components (filter input, density toggle, counts line, seven/six-column table, `Chip`); SQL Server's is a shorter shadcn `Table`. The DDL tab is three copies of "header strip + copy button + `<pre>`".

**Files:**
- Create: `src/components/workspace/sql/types.ts`
- Create: `src/components/workspace/sql/structure-panel.tsx`
- Create: `src/components/workspace/sql/ddl-panel.tsx`
- Create: `src/components/workspace/sql/structure-panel.dom.test.tsx`
- Modify: the three `table-detail-client.tsx` files

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
// src/components/workspace/sql/types.ts
export interface SqlColumn {
  name: string;
  position: number;
  /** Display type as the server reports it: "integer", "varchar(255)", "nvarchar(max)". */
  dataType: string;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isUnique?: boolean;
  comment?: string | null;
  /** MySQL's `extra` / SQL Server's IDENTITY(…) / computed marker. Null hides the column. */
  extra?: string | null;
}
```

```tsx
// src/components/workspace/sql/structure-panel.tsx
export function StructurePanel(props: {
  columns: SqlColumn[];
  /** Extra chips per column, after pk / not null / unique — postgres puts FK links here. */
  extraChips?: (column: SqlColumn) => React.ReactNode;
  /** Toolbar action on the right — postgres's "Modify columns". */
  action?: React.ReactNode;
}): React.ReactElement;
```

```tsx
// src/components/workspace/sql/ddl-panel.tsx
export function DdlPanel(props: { label: string; ddl: string }): React.ReactElement;
```

`StructurePanel` shows the Extra column when **any** row has a non-null `extra`, so MySQL gets it and Postgres does not — no flag to pass and no way for the two to disagree.

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/sql/structure-panel.dom.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StructurePanel } from "./structure-panel";
import type { SqlColumn } from "./types";

const COLUMNS: SqlColumn[] = [
  { name: "id", position: 1, dataType: "integer", nullable: false, default: "nextval(…)", isPrimaryKey: true },
  { name: "email", position: 2, dataType: "text", nullable: false, default: null, isPrimaryKey: false, isUnique: true },
  { name: "note", position: 3, dataType: "text", nullable: true, default: null, isPrimaryKey: false, comment: "free text" },
];

describe("StructurePanel", () => {
  it("renders one row per column with its type", () => {
    render(<StructurePanel columns={COLUMNS} />);
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("integer")).toBeInTheDocument();
    expect(screen.getByText("free text")).toBeInTheDocument();
  });

  it("summarises pk / not-null / default counts", () => {
    render(<StructurePanel columns={COLUMNS} />);
    expect(screen.getByText(/3 columns · 1 pk · 2 not null · 1 with default/)).toBeInTheDocument();
  });

  it("filters by name, type and comment", () => {
    render(<StructurePanel columns={COLUMNS} />);
    fireEvent.change(screen.getByPlaceholderText(/filter by name/i), {
      target: { value: "free" },
    });
    expect(screen.getByText("note")).toBeInTheDocument();
    expect(screen.queryByText("email")).toBeNull();
  });

  it("shows an empty state when the filter matches nothing", () => {
    render(<StructurePanel columns={COLUMNS} />);
    fireEvent.change(screen.getByPlaceholderText(/filter by name/i), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/no columns match/i)).toBeInTheDocument();
  });

  it("hides the Extra column unless some column has one", () => {
    const { rerender } = render(<StructurePanel columns={COLUMNS} />);
    expect(screen.queryByRole("columnheader", { name: "Extra" })).toBeNull();
    rerender(
      <StructurePanel
        columns={[{ ...COLUMNS[0], extra: "auto_increment" }, ...COLUMNS.slice(1)]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Extra" })).toBeInTheDocument();
    expect(screen.getByText("auto_increment")).toBeInTheDocument();
  });

  it("renders caller-supplied chips and toolbar action", () => {
    render(
      <StructurePanel
        columns={COLUMNS}
        extraChips={(c) => (c.name === "email" ? <span>→ other.table.id</span> : null)}
        action={<button type="button">Modify columns</button>}
      />,
    );
    expect(screen.getByText("→ other.table.id")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modify columns" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/sql/structure-panel.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `types.ts`, `structure-panel.tsx` and `ddl-panel.tsx`**

Build `StructurePanel` by lifting the Postgres `StructurePanel` (`table-detail-client.tsx:1380-1615`) plus its `Chip` helper verbatim, then:
- rename `c.isNullable` → `c.nullable` and `c.position` stays,
- replace the hard-coded FK-links block with `extraChips?.(c)`,
- replace the hard-coded "Modify columns" button with `{action}`,
- add the conditional Extra column (`const showExtra = columns.some((c) => c.extra != null)`), rendering `<th>Extra</th>` and the cell only when true, and widening the empty-state `colSpan` to `showExtra ? 7 : 6`.

`Chip` moves into `structure-panel.tsx` as a non-exported helper with the Postgres three-tone signature (`"brand" | "muted" | "link"`) — MySQL's two-tone version is a subset.

`DdlPanel` is the Postgres DDL tab body (`table-detail-client.tsx:835-866`) with `label` replacing the hard-coded `generated CREATE TABLE` and `ddl` replacing the state read. Keep the `copied` flag, the 1500 ms reset, and the `toast.error("Could not copy")` fallback.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/workspace/sql/structure-panel.dom.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Adopt in all three clients**

Each client gains a small adapter next to its existing interfaces and drops its private panel:

```tsx
// postgres — ColumnInfo → SqlColumn
const sqlColumns: SqlColumn[] = (columns ?? []).map((c) => ({
  name: c.name,
  position: c.position,
  dataType: c.dataType,
  nullable: c.isNullable,
  default: c.default,
  isPrimaryKey: c.isPrimaryKey,
  isUnique: c.isUnique,
  comment: c.comment,
}));
```

```tsx
// mysql — ColumnInfo → SqlColumn
const sqlColumns: SqlColumn[] = (columns ?? []).map((c) => ({
  name: c.name,
  position: c.ordinal,
  dataType: c.columnType,
  nullable: c.nullable,
  default: c.default,
  isPrimaryKey: c.isPrimaryKey,
  comment: c.comment || null,
  extra: c.extra || null,
}));
```

```tsx
// sqlserver — Column → SqlColumn.
// SqlServerColumn carries no ordinal field, so position comes from the array
// index: getSqlServerTableDetail's catalog query returns columns in ordinal
// order, which is the only ordering the Structure tab ever displayed.
const sqlColumns: SqlColumn[] = (detail?.columns ?? []).map((c, i) => ({
  name: c.name,
  position: i + 1,
  dataType: c.dataType,
  nullable: c.nullable,
  default: c.isComputed ? c.computedDefinition : c.defaultDefinition,
  isPrimaryKey: c.isPrimaryKey,
  extra: c.isIdentity
    ? `IDENTITY(${c.identitySeed},${c.identityIncrement})`
    : c.isComputed
      ? "computed"
      : null,
}));
```

Postgres passes `extraChips={(c) => columnFkLinks(c.name, foreignKeys).map(...)}` (keep `columnFkLinks` in the postgres file — it reads `ForeignKeyInfo`, a postgres type) and `action={<Button …>Modify columns</Button>}`. MySQL and SQL Server pass neither.

Delete the private `StructurePanel` and `Chip` from the postgres and mysql clients, and replace SQL Server's Structure `TabsContent` body with `<StructurePanel columns={sqlColumns} />`. Replace all three DDL tab bodies with `<DdlPanel label="…" ddl={…} />` (labels: `generated CREATE TABLE`, `SHOW CREATE TABLE`, `generated CREATE TABLE`).

- [ ] **Step 6: Verify the safety net still passes unchanged**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean, and specifically the six Phase 1 characterization suites pass **with no edits**. The postgres suite's `renders the column list on the Structure tab` and the sqlserver/mysql equivalents are the ones that prove the swap.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace/sql/ "src/app/postgres" "src/app/mysql" "src/app/sqlserver"
git commit -m "refactor(sql): share StructurePanel and DdlPanel across the three workspaces"
```

---

## Task 7: `DataGrid` + `GridToolbar` + `filterRows`

The Data tab appears three times: Postgres and SQL Server render `rows: unknown[][]` against `fields`, MySQL renders `rows: Record<string, ColumnValue>[]` against `columns`. Postgres and MySQL both carry the filter input, density toggle, counts line, null/object/boolean cell styling, hover row actions and the "No rows match" empty state; SQL Server has a plainer table and no filter.

**Files:**
- Create: `src/components/workspace/sql/data-grid.tsx`
- Create: `src/components/workspace/sql/data-grid.dom.test.tsx`
- Modify: the three `table-detail-client.tsx` files

**Interfaces:**
- Consumes: nothing.
- Produces:

```tsx
export interface GridColumn {
  name: string;
  /** Second line under the header — type, plus " · NOT NULL". */
  hint?: string;
  isPrimaryKey?: boolean;
}
export type GridDensity = "compact" | "normal";
export type GridSort = { column: string; dir: "asc" | "desc" } | null;

/** Case-insensitive substring match across every cell of a row. Pure; exported for tests. */
export function filterRows(rows: unknown[][], query: string): unknown[][];

export function GridToolbar(props: {
  filter: string;
  onFilterChange: (value: string) => void;
  density: GridDensity;
  onDensityChange: (density: GridDensity) => void;
  /** Free-form status text — row counts, match counts, ranges. */
  status: React.ReactNode;
  /** Right-hand slot: Export / Insert row / Refresh. */
  children?: React.ReactNode;
}): React.ReactElement;

export function DataGrid(props: {
  columns: GridColumn[];
  rows: unknown[][];
  density: GridDensity;
  sort?: GridSort;
  onToggleSort?: (column: string) => void;
  rowActions?: (row: unknown[], index: number) => React.ReactNode;
  empty: React.ReactNode;
}): React.ReactElement;
```

`DataGrid` takes **already-filtered** rows: the caller owns filter state because it also renders the match count in the toolbar. `filterRows` is the shared implementation of that filtering.

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/sql/data-grid.dom.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataGrid, GridToolbar, filterRows, type GridColumn } from "./data-grid";

const COLUMNS: GridColumn[] = [
  { name: "id", hint: "int4 · NOT NULL", isPrimaryKey: true },
  { name: "email", hint: "text" },
  { name: "meta", hint: "jsonb" },
];
const ROWS: unknown[][] = [
  [1, "a@example.com", { tier: "gold" }],
  [2, null, null],
  [3, "c@example.com", true],
];

describe("filterRows", () => {
  it("matches case-insensitively across every cell", () => {
    expect(filterRows(ROWS, "A@EXAMPLE")).toEqual([ROWS[0]]);
  });
  it("searches inside serialized objects", () => {
    expect(filterRows(ROWS, "gold")).toEqual([ROWS[0]]);
  });
  it("never matches a null cell", () => {
    expect(filterRows(ROWS, "null")).toEqual([]);
  });
  it("returns every row for an empty or whitespace query", () => {
    expect(filterRows(ROWS, "   ")).toEqual(ROWS);
  });
});

describe("DataGrid", () => {
  it("renders a header per column with its hint, and every cell", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />);
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("int4 · NOT NULL")).toBeInTheDocument();
    expect(screen.getByText("a@example.com")).toBeInTheDocument();
  });

  it("renders null cells as an italic null, objects as JSON, booleans as text", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />);
    expect(screen.getAllByText("null").length).toBeGreaterThan(0);
    expect(screen.getByText('{"tier":"gold"}')).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("renders the empty slot when there are no rows", () => {
    render(<DataGrid columns={COLUMNS} rows={[]} density="compact" empty="No rows match “zz”." />);
    expect(screen.getByText("No rows match “zz”.")).toBeInTheDocument();
  });

  it("calls onToggleSort with the clicked column when sorting is enabled", () => {
    const onToggleSort = vi.fn();
    render(
      <DataGrid
        columns={COLUMNS}
        rows={ROWS}
        density="compact"
        sort={{ column: "id", dir: "asc" }}
        onToggleSort={onToggleSort}
        empty="No rows."
      />,
    );
    fireEvent.click(screen.getByRole("columnheader", { name: /email/ }));
    expect(onToggleSort).toHaveBeenCalledWith("email");
  });

  it("does not make headers clickable when sorting is not wired", () => {
    render(<DataGrid columns={COLUMNS} rows={ROWS} density="compact" empty="No rows." />);
    fireEvent.click(screen.getByRole("columnheader", { name: /email/ }));
    // No throw, no handler — the assertion is simply that nothing is wired.
    expect(screen.getByRole("columnheader", { name: /email/ })).toBeInTheDocument();
  });

  it("renders row actions in a trailing cell", () => {
    render(
      <DataGrid
        columns={COLUMNS}
        rows={ROWS}
        density="compact"
        rowActions={(_row, i) => <button type="button">edit {i}</button>}
        empty="No rows."
      />,
    );
    expect(screen.getByRole("button", { name: "edit 0" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^edit / })).toHaveLength(3);
  });
});

describe("GridToolbar", () => {
  it("reports filter and density changes", () => {
    const onFilterChange = vi.fn();
    const onDensityChange = vi.fn();
    render(
      <GridToolbar
        filter=""
        onFilterChange={onFilterChange}
        density="compact"
        onDensityChange={onDensityChange}
        status="3 rows"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/filter rows/i), {
      target: { value: "abc" },
    });
    expect(onFilterChange).toHaveBeenCalledWith("abc");
    fireEvent.click(screen.getByTitle("Normal rows"));
    expect(onDensityChange).toHaveBeenCalledWith("normal");
    expect(screen.getByText("3 rows")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/sql/data-grid.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Lift the Postgres Data tab's table (`table-detail-client.tsx:464-589`) as `DataGrid`, and its toolbar left half (`395-448`) as `GridToolbar`. Keep verbatim: the `cellPad` / `headPad` density strings, `max-w-[40ch] truncate`, the `title={cell == null ? "null" : String(cell)}` hover, the sticky `thead`, and the null/object/boolean cell styling. Changes:
- the header `<th>` gets `onClick={onToggleSort ? () => onToggleSort(col.name) : undefined}`, plus the `cursor-pointer select-none hover:bg-foreground/[0.04]` classes and the `ArrowUp`/`ArrowDown` indicator only when `onToggleSort` is set (that is MySQL's behaviour today; Postgres and SQL Server have no sorting);
- the trailing actions `<th>`/`<td>` render only when `rowActions` is set;
- the empty row's `colSpan` is `columns.length + (rowActions ? 1 : 0)` clamped to at least 1.

`filterRows`:

```ts
export function filterRows(rows: unknown[][], query: string): unknown[][] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    row.some((cell) => {
      if (cell == null) return false;
      const text = typeof cell === "object" ? JSON.stringify(cell) : String(cell);
      return text.toLowerCase().includes(q);
    }),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/workspace/sql/data-grid.dom.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 5: Adopt in Postgres and SQL Server (native `unknown[][]`)**

Postgres: replace the toolbar and table markup with `<GridToolbar>` + `<DataGrid>`, mapping `pageData.fields` to `GridColumn[]`:

```tsx
const gridColumns: GridColumn[] = (pageData?.fields ?? []).map((f) => {
  const col = columns?.find((c) => c.name === f.name);
  return {
    name: f.name,
    hint: `${col?.dataType ?? f.dataType}${col && !col.isNullable ? " · NOT NULL" : ""}`,
    isPrimaryKey: !!col?.isPrimaryKey,
  };
});
```

`filteredRows` becomes `filterRows(pageData?.rows ?? [], filter)`. `rowActions` returns the existing hover Edit/Delete buttons. SQL Server does the same but passes no `rowActions` (Task 11 adds them) and no filter — render `<DataGrid>` without `<GridToolbar>`, keeping its existing row-count line and Insert button.

- [ ] **Step 6: Adopt in MySQL (row objects → tuples)**

MySQL's rows are keyed objects. Adapt at the boundary rather than changing the API:

```tsx
const gridRows: unknown[][] = (pageData?.rows ?? []).map((r) =>
  (pageData?.columns ?? []).map((c) => r[c] ?? null),
);
const filteredGridRows = filterRows(gridRows, filter);
```

`rowActions={(row, i) => …}` needs the original object for `setEditTarget` / `setDeleteTarget`; index into the unfiltered array by identity is unsafe after filtering, so filter the **objects** and derive tuples from the filtered list:

```tsx
const filteredObjects = (pageData?.rows ?? []).filter((r) =>
  filterRows([ (pageData?.columns ?? []).map((c) => r[c] ?? null) ], filter).length > 0,
);
const filteredGridRows = filteredObjects.map((r) =>
  (pageData?.columns ?? []).map((c) => r[c] ?? null),
);
// rowActions: (_row, i) => … filteredObjects[i] …
```

`exportRows` keeps working — point it at `filteredObjects`.

- [ ] **Step 7: Verify the safety net still passes unchanged**

Run: `npm run typecheck && npm run lint && npm test`
Expected: clean; the six characterization suites unedited. The postgres/mysql "shows row data on the default Data tab" and "offers row-level insert, edit and delete" tests are the ones that police this swap.

- [ ] **Step 8: Commit**

```bash
git add src/components/workspace/sql/ "src/app/postgres" "src/app/mysql" "src/app/sqlserver"
git commit -m "refactor(sql): share the data grid, its toolbar and row filtering"
```

---

## Task 8: `MetaTable` and the indexes / constraints / foreign-keys panels

Six near-identical shadcn-`Table` blocks across the three clients render index, constraint and FK metadata. They differ only in their column set.

**Files:**
- Create: `src/components/workspace/sql/meta-table.tsx`
- Create: `src/components/workspace/sql/meta-table.dom.test.tsx`
- Modify: the three `table-detail-client.tsx` files

**Interfaces:**
- Consumes: nothing.
- Produces:

```tsx
export interface MetaColumn<T> {
  header: React.ReactNode;
  align?: "left" | "right";
  /** Applied to the <th> — width hints like "w-px". */
  headClassName?: string;
  cell: (item: T) => React.ReactNode;
}

export function MetaTable<T>(props: {
  items: T[];
  columns: MetaColumn<T>[];
  rowKey: (item: T) => string;
  rowClassName?: (item: T) => string | undefined;
  /** Rendered instead of the table when items is empty. */
  empty: React.ReactNode;
}): React.ReactElement;
```

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/sql/meta-table.dom.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MetaTable, type MetaColumn } from "./meta-table";

interface Idx { name: string; unique: boolean }
const COLUMNS: MetaColumn<Idx>[] = [
  { header: "Name", cell: (i) => i.name },
  { header: "Kind", cell: (i) => (i.unique ? "unique" : "—") },
];
const ITEMS: Idx[] = [
  { name: "users_pkey", unique: true },
  { name: "idx_users_email", unique: false },
];

describe("MetaTable", () => {
  it("renders one row per item across the declared columns", () => {
    render(<MetaTable items={ITEMS} columns={COLUMNS} rowKey={(i) => i.name} empty="No indexes." />);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByText("users_pkey")).toBeInTheDocument();
    expect(screen.getByText("idx_users_email")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("renders the empty slot instead of a table when there are no items", () => {
    render(<MetaTable items={[]} columns={COLUMNS} rowKey={(i) => i.name} empty="No indexes." />);
    expect(screen.getByText("No indexes.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("applies a per-row class from rowClassName", () => {
    render(
      <MetaTable
        items={ITEMS}
        columns={COLUMNS}
        rowKey={(i) => i.name}
        rowClassName={(i) => (i.unique ? "bg-amber-500/5" : undefined)}
        empty="No indexes."
      />,
    );
    expect(screen.getByText("users_pkey").closest("tr")).toHaveClass("bg-amber-500/5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/sql/meta-table.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `meta-table.tsx`**

```tsx
"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Metadata list — indexes, constraints, foreign keys. Six copies of this
 * markup existed across the three SQL table-detail clients; only the column
 * set ever differed, so that is the only thing callers supply.
 */
export interface MetaColumn<T> {
  header: React.ReactNode;
  align?: "left" | "right";
  headClassName?: string;
  cell: (item: T) => React.ReactNode;
}

export function MetaTable<T>({
  items,
  columns,
  rowKey,
  rowClassName,
  empty,
}: {
  items: T[];
  columns: MetaColumn<T>[];
  rowKey: (item: T) => string;
  rowClassName?: (item: T) => string | undefined;
  empty: React.ReactNode;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead
                key={i}
                className={cn(c.align === "right" && "text-right", c.headClassName)}
              >
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={rowKey(item)} className={cn("group", rowClassName?.(item))}>
              {columns.map((c, i) => (
                <TableCell key={i} className={cn(c.align === "right" && "text-right")}>
                  {c.cell(item)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/workspace/sql/meta-table.dom.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Convert all six metadata tables**

Each conversion moves the existing `<TableHead>` / `<TableCell>` JSX into a `MetaColumn<T>[]` array declared next to the component, preserving every class string exactly. Six arrays:

- postgres `indexes` — Name (+ unused pill) / Kind / Size (right) / Scans (right) / Tuples read (right) / Definition / actions (`headClassName: "w-px"`), `rowClassName: (i) => i.unused ? "bg-amber-500/5" : undefined`
- postgres `constraints` — Name / Type / Definition
- postgres `foreign_keys` — Name / Columns / References / On update / On delete
- mysql `indexes` — Name / Kind / Type / Columns / actions (`w-px`)
- sqlserver `indexes` — Name (+ badges + unused pill) / Type / Key columns / Size (right) / Seeks-Scans (right), same `rowClassName`
- sqlserver `constraints` — Name / Type / Definition; sqlserver `foreign_keys` — Name / Columns / References / On update-delete

Keep the "No indexes." / "No constraints." / "No foreign keys." / "No check/default constraints." strings exactly as they are today — they are asserted on by the e2e spec's error scan only indirectly, but changing user-visible copy is not part of a refactor.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: clean, characterization suites unedited.

```bash
git add src/components/workspace/sql/ "src/app/postgres" "src/app/mysql" "src/app/sqlserver"
git commit -m "refactor(sql): share the metadata table behind the indexes/constraints/FK panels"
```

---

## Task 9: One `RowFormDialog`

Three copies, 1217 lines total. They share the dialog shell, the tri-state cell editor (`null` / `default` / value), the long-text textarea, boolean pills and the submit/reset lifecycle. They genuinely differ in three ways, all of which become props:

| | Postgres | MySQL | SQL Server |
|---|---|---|---|
| tint | brand | brand | rose |
| locked on insert | columns with a `default` | `auto_increment` columns | `IDENTITY` columns and columns with a default |
| long-text detection | `text` / `json` / `jsonb` | `text` / `json` / `blob` | `ntext` / `xml` / `(max)` |
| boolean detection | `boolean` | `tinyint(1)` | `bit` |
| edit-mode identity | `pk: [{column, value}]` | `pk: Record<string, value>` | `pk: [{column, value}]` |
| request value shape | tagged union | plain scalar | tagged union |

**Files:**
- Create: `src/components/workspace/sql/row-form-dialog.tsx`
- Create: `src/components/workspace/sql/row-form-dialog.dom.test.tsx`
- Delete: the three `row-form-dialog.tsx` files under `src/app/{postgres,mysql,sqlserver}/...`
- Modify: the three `table-detail-client.tsx` files

**Interfaces:**
- Consumes: `SqlColumn` from `./types`.
- Produces:

```tsx
export type CellState = { kind: "null" } | { kind: "default" } | { kind: "value"; value: string };

export interface RowFormDialect {
  tint: "brand" | "rose";
  /** Column is not settable on insert (IDENTITY / auto_increment / server default). */
  lockedOnInsert: (column: SqlColumn) => boolean;
  isLongText: (dataType: string) => boolean;
  isBoolean: (dataType: string) => boolean;
  /** Turn the edited cell map into this tech's request body. */
  toBody: (args: {
    mode: "insert" | "edit";
    values: Record<string, CellState>;
    columns: SqlColumn[];
    initialRow: Record<string, unknown> | undefined;
  }) => unknown;
}

export function RowFormDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "insert" | "edit";
  /** API base URL; the dialog POSTs/PATCHes `${base}/rows`. */
  base: string;
  title: string;
  columns: SqlColumn[];
  /** The row being edited, keyed by column name. Undefined on insert. */
  initialRow?: Record<string, unknown>;
  dialect: RowFormDialect;
  onSuccess: () => void;
}): React.ReactElement;
```

Normalizing `initialRow` to `Record<string, unknown>` removes the third divergence: Postgres and SQL Server pass `{fields, cells}` today and MySQL passes a keyed object — the two array-shaped callers zip at the call site, one line each.

- [ ] **Step 1: Write the failing test**

Create `src/components/workspace/sql/row-form-dialog.dom.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { mockFetch, httpError } from "@/test/fetch-mock";
import { RowFormDialog, type RowFormDialect, type CellState } from "./row-form-dialog";
import type { SqlColumn } from "./types";

const COLUMNS: SqlColumn[] = [
  { name: "id", position: 1, dataType: "integer", nullable: false, default: "nextval(…)", isPrimaryKey: true },
  { name: "email", position: 2, dataType: "text", nullable: false, default: null, isPrimaryKey: false },
  { name: "bio", position: 3, dataType: "text", nullable: true, default: null, isPrimaryKey: false },
  { name: "active", position: 4, dataType: "boolean", nullable: false, default: null, isPrimaryKey: false },
];

// A minimal dialect standing in for the three real ones. Each real dialect is
// exercised end-to-end by its own workspace's characterization suite; what
// this file proves is that the shared dialog honours whatever it is handed.
const DIALECT: RowFormDialect = {
  tint: "brand",
  lockedOnInsert: (c) => c.default !== null,
  isLongText: (dt) => dt === "text",
  isBoolean: (dt) => dt === "boolean",
  toBody: ({ mode, values, columns, initialRow }) => ({
    mode,
    values,
    pk: columns
      .filter((c) => c.isPrimaryKey)
      .map((c) => ({ column: c.name, value: initialRow?.[c.name] ?? null })),
  }),
};

let restore: () => void;
beforeEach(() => {
  restore = mockFetch({ "/rows": { rowsAffected: 1 } });
});
afterEach(() => restore());

function lastBody(): Record<string, unknown> {
  const calls = (globalThis.fetch as unknown as {
    mock: { calls: [string, RequestInit?][] };
  }).mock.calls;
  return JSON.parse(String(calls[calls.length - 1][1]!.body));
}

function renderInsert(onSuccess = vi.fn()) {
  render(
    <RowFormDialog
      open
      onOpenChange={() => {}}
      mode="insert"
      base="/api/postgres/c1/databases/appdb/schemas/public/tables/users"
      title="Insert row"
      columns={COLUMNS}
      dialect={DIALECT}
      onSuccess={onSuccess}
    />,
  );
}

describe("RowFormDialog", () => {
  it("starts a column the dialect locks on insert in its default state", () => {
    renderInsert();
    // `id` has a server default, so it is not settable — its editor is off and
    // the cell reads `default`, not an empty value.
    const idRow = screen.getByText("id").closest("[data-row]")!;
    expect(idRow).toHaveTextContent("default");
    expect(idRow.querySelector("input,textarea")).toBeNull();
  });

  it("renders a textarea for long-text columns and an input for the rest", () => {
    renderInsert();
    expect(screen.getByLabelText("bio").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("active").tagName).not.toBe("TEXTAREA");
  });

  it("sends a typed value in the tagged-union shape the dialect asked for", async () => {
    const onSuccess = vi.fn();
    renderInsert(onSuccess);
    fireEvent.change(screen.getByLabelText("email"), {
      target: { value: "a@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const body = lastBody() as { values: Record<string, CellState> };
    expect(body.values.email).toEqual({ kind: "value", value: "a@example.com" });
    expect(body.values.id).toEqual({ kind: "default" });
  });

  it("sends an explicit null when the null toggle is used", async () => {
    const onSuccess = vi.fn();
    renderInsert(onSuccess);
    fireEvent.click(screen.getByRole("button", { name: /set bio to null/i }));
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect((lastBody() as { values: Record<string, CellState> }).values.bio).toEqual({
      kind: "null",
    });
  });

  it("PATCHes in edit mode and carries the original primary key", async () => {
    const onSuccess = vi.fn();
    render(
      <RowFormDialog
        open
        onOpenChange={() => {}}
        mode="edit"
        base="/api/postgres/c1/databases/appdb/schemas/public/tables/users"
        title="Edit row"
        columns={COLUMNS}
        initialRow={{ id: 7, email: "old@example.com", bio: null, active: true }}
        dialect={DIALECT}
        onSuccess={onSuccess}
      />,
    );
    expect(screen.getByLabelText("email")).toHaveValue("old@example.com");
    fireEvent.change(screen.getByLabelText("email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const calls = (globalThis.fetch as unknown as {
      mock: { calls: [string, RequestInit?][] };
    }).mock.calls;
    expect(calls[calls.length - 1][1]!.method).toBe("PATCH");
    expect(lastBody().pk).toEqual([{ column: "id", value: 7 }]);
  });

  it("surfaces the server error and keeps the dialog open on failure", async () => {
    restore();
    restore = mockFetch({
      "/rows": httpError(502, 'duplicate key value violates unique constraint "users_email_key"'),
    });
    const onSuccess = vi.fn();
    renderInsert(onSuccess);
    fireEvent.change(screen.getByLabelText("email"), {
      target: { value: "a@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^insert$/i }));
    expect(await screen.findByText(/duplicate key value/)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
```

Two of these assertions describe markup the three existing dialogs do not currently emit: a `data-row` attribute per column row, and an `aria-label` on each field equal to the column name. Add both to the shared dialog in Step 3 — they are the accessible names a row editor should have had anyway, and without them the tests can only match on brittle DOM position. Read the three dialogs being replaced for the exact submit-button copy (`Insert` / `Save`) and null-toggle copy before finalising the queries above; if they differ, the dialogs win and these queries change.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/workspace/sql/row-form-dialog.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the shared dialog**

Start from the Postgres copy (the smallest at 378 lines, and already on the tagged-union model). Replace `isJsonType`/boolean detection with `dialect.isLongText` / `dialect.isBoolean`, replace the initial-values rule with `dialect.lockedOnInsert`, thread `tint` into the accent classes (`rose` reproduces the SQL Server `bg-rose-600 …` submit button), and replace the two request bodies with `dialect.toBody(...)`.

Three dialect objects live next to their clients (`postgres-row-dialect.ts` etc. or inline in the client file — inline is fine, they are ~20 lines each). MySQL's `toBody` flattens the tri-state to the plain scalars its API expects:

```ts
// mysql dialect
toBody: ({ mode, values, columns, initialRow }) => {
  const out: Record<string, string | null> = {};
  for (const c of columns) {
    const v = values[c.name];
    if (v.kind === "default") continue;      // omit → server applies the default
    out[c.name] = v.kind === "null" ? null : v.value;
  }
  return mode === "insert"
    ? { values: out }
    : {
        values: out,
        pk: Object.fromEntries(
          columns.filter((c) => c.isPrimaryKey).map((c) => [c.name, initialRow?.[c.name] ?? null]),
        ),
      };
},
```

Postgres and SQL Server keep the tagged union and the `pk: [{column, value}]` array form — copy their existing bodies verbatim from the dialogs being deleted.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/workspace/sql/row-form-dialog.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Switch all three call sites and delete the old files**

Postgres and SQL Server zip their array-shaped rows at the call site:

```tsx
initialRow={
  editTarget
    ? Object.fromEntries(editTarget.fields.map((f, i) => [
        typeof f === "string" ? f : f.name,
        editTarget.cells[i],
      ]))
    : undefined
}
```

Then `git rm` the three old dialogs.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: clean. The characterization suites' "offers row-level insert, edit and delete" assertions must still pass unedited.

```bash
git add -A
git commit -m "refactor(sql): one RowFormDialog with a per-tech dialect, replacing three copies"
```

**Branch B is complete.** Merge to `main`. Record the line-count delta across the three `table-detail-client.tsx` files in the task report — it is the headline number for L1.

---

# Branch C — `refactor/sql-table-detail-shell` (L2)

## Task 10: `SqlTableDetail` shell + descriptor, with the Postgres adapter

**Files:**
- Create: `src/components/workspace/sql/descriptor.ts`
- Create: `src/components/workspace/sql/sql-table-detail.tsx`
- Create: `src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/stats-grid.tsx`
- Modify: `src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/table-detail-client.tsx`

**Interfaces:**
- Consumes: `ErrorState`, `StructurePanel`, `DdlPanel`, `DataGrid`, `GridToolbar`, `filterRows`, `MetaTable`, `RowFormDialog`, `SqlColumn`.
- Produces:

```ts
// src/components/workspace/sql/descriptor.ts
export type TableTab =
  | "data" | "structure" | "indexes" | "constraints" | "foreign_keys" | "ddl" | "stats";

export interface SqlTableDetailDescriptor<TCtx> {
  tech: TechId;
  tabs: TableTab[];
  /** Header labels, e.g. { data: "Data", foreign_keys: "Foreign keys" }. */
  labels?: Partial<Record<TableTab, string>>;
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
    | { strategy: "single"; fetchAll(ctx: TCtx, signal: AbortSignal): Promise<unknown> };
  /** Panels only one tech has, and per-tech column specs for the shared panels. */
  render?: Partial<Record<TableTab, (data: unknown, ctx: TCtx) => React.ReactNode>>;
}
```

```tsx
export function SqlTableDetail<TCtx>(props: {
  descriptor: SqlTableDetailDescriptor<TCtx>;
  ctx: TCtx;
  title: React.ReactNode;
  description: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactElement;
```

The shell owns: tab state, the fetch-per-strategy dispatch, `AbortController` wiring with the unmount cleanup AGENTS.md requires, the error map and its `ErrorState` rendering, the retry path, and refresh-after-mutation. `load` is the load-bearing part — Postgres is `per-tab`, MySQL and SQL Server are `single`, and the shell behaves identically either way.

- [ ] **Step 1: Confirm the safety net is the test**

There is no new test file in this task. The proof that the shell is behaviour-preserving is that `src/app/postgres/.../table-detail-client.dom.test.tsx` — 8 tests after Task 2, including the per-tab-laziness test and all three error tests — passes **without a single edit**. Read that file before writing the shell; it is the specification.

- [ ] **Step 2: Write `descriptor.ts`**

Exactly the types above. `TechId` comes from `@/lib/connections/types`.

- [ ] **Step 3: Write `sql-table-detail.tsx`**

Structure:

```tsx
export function SqlTableDetail<TCtx>({ descriptor, ctx, title, description, actions }) {
  const [tab, setTab] = useState<TableTab>(descriptor.tabs[0]);
  const [data, setData] = useState<Partial<Record<TableTab, unknown>>>({});
  const [errors, setErrors] = useState<Partial<Record<TableTab, string>>>({});
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  // per-tab: fetch `tab` when data[tab] === undefined && !errors[tab]
  // single:  fetch once, fan the result out to every tab key
  …
}
```

Rules the shell must honour, each of which a Phase 1 characterization test already checks somewhere:
- **`per-tab` never fetches a tab before it opens.** The postgres suite's "the DDL view is not requested until its tab opens" test fails otherwise.
- **`single` fetches once on mount** and populates every non-`data` tab from the one payload.
- **A failed tab does not retry on every render** — the effect guard includes `!errors[tab]`.
- **Retry clears the error key and the cached data**, which lets the effect refire.
- **Aborts on unmount**, per AGENTS.md's `useEffect(() => () => abortRef.current?.abort(), [])` convention.

Panels render from `descriptor.render?.[tab]` when present, otherwise from the shared panel matching the tab key.

- [ ] **Step 4: Rewrite the Postgres client as a descriptor**

First, extract the postgres-only statistics panel to its own file. Create `src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/stats-grid.tsx` and move `StatsGrid`, `UnsupportedKind`, `formatRelative`, `formatBytes` and `formatNumber` into it verbatim (~230 lines), exporting `StatsGrid` and the `TableStats` interface. This is a pure move — no logic changes — and it is what makes exit criterion 6 reachable: those five helpers are 271 of the client's remaining lines and none of them is shell material.

`table-detail-client.tsx` then keeps: its `Props`, the `?modify=1` deep-link effect, `dropTarget`, the four dialogs (`RowFormDialog`, `CreateIndexDialog`, `ModifyTableDialog`, `DropConfirm`), the rename/drop-index alert dialogs, `columnFkLinks`, and a one-line `render.stats` entry pointing at the imported `StatsGrid` (the `render` escape hatch the spec calls for). Everything else becomes the descriptor.

- [ ] **Step 5: Run the postgres safety net unchanged**

Run: `npx vitest run "src/app/postgres/[connectionId]/databases/[db]/schemas/[schema]/tables/[table]/table-detail-client.dom.test.tsx"`
Expected: PASS — 8 tests, file unedited. If a test needs editing to pass, the shell has changed behaviour; fix the shell, not the test.

- [ ] **Step 6: Commit**

```bash
git checkout -b refactor/sql-table-detail-shell
git add src/components/workspace/sql/ "src/app/postgres"
git commit -m "refactor(sql): introduce SqlTableDetail and move postgres onto it"
```

---

## Task 11: MySQL and SQL Server adapters

**Files:**
- Modify: `src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.tsx`
- Modify: `src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.tsx`

**Interfaces:**
- Consumes: `SqlTableDetail`, `SqlTableDetailDescriptor` (Task 10).
- Produces: no exported surface change — both clients keep their existing props.

- [ ] **Step 1: Convert SQL Server (the simpler `single`-strategy case)**

`fetchAll` GETs `base` and returns the `Detail` payload; the shell fans it out. Tabs: `data, structure, indexes, constraints, foreign_keys, ddl`. Capabilities: everything false except `insertRow` and `dropTable` (Task 12 flips `editRow` / `deleteRow`). `render.ddl` stays local — `buildClientDdl` is a deliberate one-tech panel that avoids a round-trip.

- [ ] **Step 2: Run the SQL Server safety net unchanged**

Run: `npx vitest run "src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.dom.test.tsx"`
Expected: PASS, file unedited.

- [ ] **Step 3: Convert MySQL**

`fetchAll` GETs `base`, returning `{ columns, indexes, ddl, primaryKey }`. `data` is its own fetch against `${base}/rows` (the shell already treats `data` separately in both strategies). Tabs: `data, structure, indexes, ddl`. Capabilities: `insertRow`, `editRow`, `deleteRow` gated on `primaryKey.length > 0`, plus `truncate`, `dropTable`, `createIndex`, `dropIndex`.

- [ ] **Step 4: Run the MySQL safety net unchanged**

Run: `npx vitest run "src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.dom.test.tsx"`
Expected: PASS, file unedited.

- [ ] **Step 5: Full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: clean.

- [ ] **Step 6: Re-run the live suites**

Run: `npm run test:integration`, then `npx playwright test e2e/sql-workspaces.spec.ts --reporter=list`
Expected: same pass counts as Task 0 Step 6. This is the first point in Phase 2 where the whole rendering path has changed; the e2e tab-walk is the only thing that exercises it against real data.

- [ ] **Step 7: Commit**

```bash
git add "src/app/mysql" "src/app/sqlserver"
git commit -m "refactor(sql): move mysql and sqlserver onto SqlTableDetail"
```

**Branch C is complete.** Merge to `main`.

---

# Branch D — `feat/sql-workspace-convergence` (L3)

## Task 12: SQL Server per-row edit and delete

The driver (`updateSqlServerRow` / `deleteSqlServerRow` in `src/lib/connections/sqlserver/rows.ts`) and the route (`PATCH` / `DELETE` on `.../rows`, bodies `{pk: SqlServerPrimaryKeyValue[], values}` and `{pk}`) already exist and are unused. The shared `RowFormDialog` already supports `mode="edit"`. This is capability flags plus a delete confirm.

**Files:**
- Modify: `src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.tsx`
- Test: same directory's `.dom.test.tsx`

**Interfaces:**
- Consumes: `RowFormDialog` (Task 9), `SqlTableDetail` capabilities (Task 10).
- Produces: no exported surface change.

- [ ] **Step 1: Write the failing tests**

Append to the SQL Server characterization suite — one of the three deliberate safety-net edits named in Global Constraints:

```tsx
  it("offers row-level edit and delete once the table has a primary key", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.getAllByRole("button", { name: /edit row/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /delete row/i }).length).toBeGreaterThan(0);
  });

  it("DELETEs the row with its primary key when the confirm is accepted", async () => {
    renderIt();
    await screen.findByText("a@example.com");
    fireEvent.click(screen.getAllByRole("button", { name: /delete row/i })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /^delete$/i }));
    await waitFor(() => {
      const call = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
        .mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(call).toBeDefined();
      expect(JSON.parse(String(call![1]!.body))).toEqual({ pk: [{ column: "id", value: 1 }] });
    });
  });

  it("disables row actions on a table with no primary key", async () => {
    restore();
    restore = mockFetch({
      "/tables/dbo/users$": {
        ...DETAIL,
        columns: DETAIL.columns.map((c) => ({ ...c, isPrimaryKey: false })),
      },
      "/data": DATA,
    });
    renderIt();
    await screen.findByText("a@example.com");
    expect(screen.getAllByRole("button", { name: /edit row/i })[0]).toBeDisabled();
  });
```

Add `"/rows"` to both route maps returning `{ rowsAffected: 1 }`, and use whatever the file names its data fixture in place of `DATA`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.dom.test.tsx"`
Expected: FAIL — no edit/delete buttons exist.

- [ ] **Step 3: Implement**

Flip `editRow` and `deleteRow` to `detail.columns.some((c) => c.isPrimaryKey)` in the descriptor, add the `editTarget` / `deleteTarget` state and the delete `AlertDialog` (copy the Postgres one's copy and structure, substituting `[schema].[table]`), and wire `rowActions` on the Data tab's `DataGrid` exactly as Postgres does — including the disabled state and the `title={canMutateRows ? "Edit row" : noPkReason}` hover, so a PK-less table degrades the same way in all three workspaces.

The delete body is the array form: `{ pk: pkColumns.map((c) => ({ column: c.name, value: byName.get(c.name) ?? null })) }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "src/app/sqlserver/[connectionId]/databases/[db]/tables/[schema]/[table]/table-detail-client.dom.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Verify against a live SQL Server**

With the stack up and seeded: open `/sqlserver/<id>/databases/demo/tables/shop/Customers`, edit a row, confirm the value round-trips after refresh, then delete a row you inserted. Record what you did in the task report — this path has no integration test.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/sql-workspace-convergence
git add "src/app/sqlserver"
git commit -m "feat(sqlserver): wire per-row edit and delete into the table workspace"
```

---

## Task 13: MySQL constraints and foreign keys

`mysql.ts` has no constraint or FK introspection at all — this is genuinely absent, not unwired.

**Files:**
- Create: `src/lib/connections/mysql-internal.ts`
- Create: `src/lib/connections/mysql-constraints.ts`
- Create: `src/lib/connections/mysql-constraints.test.ts`
- Create: `src/app/api/mysql/[id]/databases/[db]/tables/[table]/constraints/route.ts`
- Modify: `src/lib/connections/mysql.ts` (imports the helpers from the new internal module)
- Modify: `src/app/mysql/[connectionId]/databases/[db]/tables/[table]/table-detail-client.tsx`
- Modify: `src/lib/connections/services.integration.test.ts`

**Interfaces:**
- Consumes: `validateIdentifier` from `@/lib/connections/mysql` (exported today, `mysql.ts:92`).
- Produces:

```ts
// src/lib/connections/mysql-internal.ts — NOT part of the public driver surface
export function getMysql2(): Promise<typeof import("mysql2/promise")>;
export function withConn<T>(config: MysqlConfig, database: string | undefined, fn: (conn: Connection) => Promise<T>): Promise<T>;
export function query<T extends RowDataPacket = RowDataPacket>(/* existing signature */): Promise<T[]>;
```

```ts
// src/lib/connections/mysql-constraints.ts
export interface MysqlConstraint { name: string; type: string; definition: string }
export interface MysqlForeignKey {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}
/** Row shape the KEY_COLUMN_USAGE query returns, before grouping. Exported for tests. */
export interface ForeignKeyRow {
  name: string;
  column_name: string;
  ordinal: number;
  ref_schema: string;
  ref_table: string;
  ref_column: string;
  on_update: string;
  on_delete: string;
}
/** Pure: collapse per-column rows into one entry per constraint. Exported for tests. */
export function groupForeignKeyRows(rows: ForeignKeyRow[]): MysqlForeignKey[];
export function listConstraints(config: MysqlConfig, database: string, table: string): Promise<MysqlConstraint[]>;
export function listForeignKeys(config: MysqlConfig, database: string, table: string): Promise<MysqlForeignKey[]>;
```

**Why `mysql-internal.ts` exists.** `getMysql2`, `withConn` and `query` are private to `mysql.ts` today (`mysql.ts:6,52,69`) — a new sibling module cannot reach them, and exporting them from `mysql.ts` would widen the driver's public surface with connection plumbing. Phase 1 hit exactly this and answered it with `<tech>/internal.ts`, which the barrel deliberately does not re-export. This applies the same convention to the unsplit `mysql.ts`: **move** the three helpers to `mysql-internal.ts`, import them back into `mysql.ts`, and import them from `mysql-constraints.ts`. `mysql.ts`'s exported surface does not change by a single name — verify that with the same technique Phase 1 used before committing (Step 3b).

Both queries read `information_schema` with the database and table as **bound parameters**, never interpolated, so no identifier quoting is needed here at all. Still call `validateIdentifier(database, "database name")` first, so a hostile name fails the same way it does everywhere else in the driver.

- [ ] **Step 1: Write the failing test**

Create `src/lib/connections/mysql-constraints.test.ts`. The existing `mysql-readonly.test.ts` sets the convention: no driver mocking — point at an unroutable host and assert the guard rejects *before* any connection is attempted, and unit-test the pure logic directly.

```ts
import { describe, it, expect } from "vitest";
import {
  listConstraints,
  listForeignKeys,
  groupForeignKeyRows,
  type ForeignKeyRow,
} from "./mysql-constraints";

// 203.0.113.0/24 is TEST-NET-3 — guaranteed unroutable, so any assertion that
// resolves fast proves the guard fired before the driver tried to connect.
const cfg = {
  host: "203.0.113.1",
  port: 1,
  database: "x",
  user: "u",
  password: "p",
  ssl: false,
};

describe("mysql constraint introspection guards", () => {
  it("rejects a database name that is not a bare identifier", async () => {
    await expect(
      listConstraints(cfg, "demo`; DROP DATABASE demo; --", "users"),
    ).rejects.toThrow(/database name/i);
  });

  it("rejects a table name that is not a bare identifier", async () => {
    await expect(listForeignKeys(cfg, "demo", "users; DROP TABLE users")).rejects.toThrow(
      /table name/i,
    );
  });

  it("lets clean identifiers past the guard (then fails to connect)", async () => {
    await expect(listConstraints(cfg, "demo", "users")).rejects.not.toThrow(
      /database name|table name/i,
    );
  }, 20000);
});

describe("groupForeignKeyRows", () => {
  const row = (over: Partial<ForeignKeyRow>): ForeignKeyRow => ({
    name: "fk_order_items_order",
    column_name: "order_id",
    ordinal: 1,
    ref_schema: "demo",
    ref_table: "orders",
    ref_column: "id",
    on_update: "NO ACTION",
    on_delete: "CASCADE",
    ...over,
  });

  it("collapses a single-column key into one entry", () => {
    expect(groupForeignKeyRows([row({})])).toEqual([
      {
        name: "fk_order_items_order",
        columns: ["order_id"],
        refSchema: "demo",
        refTable: "orders",
        refColumns: ["id"],
        onUpdate: "NO ACTION",
        onDelete: "CASCADE",
      },
    ]);
  });

  it("collapses a composite key into one entry, in ordinal order", () => {
    // Deliberately out of order in the input — the grouping must not rely on
    // the driver returning rows already sorted.
    const grouped = groupForeignKeyRows([
      row({ name: "fk_c", column_name: "b", ordinal: 2, ref_column: "rb" }),
      row({ name: "fk_c", column_name: "a", ordinal: 1, ref_column: "ra" }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].columns).toEqual(["a", "b"]);
    expect(grouped[0].refColumns).toEqual(["ra", "rb"]);
  });

  it("keeps separate constraints separate", () => {
    const grouped = groupForeignKeyRows([
      row({ name: "fk_a" }),
      row({ name: "fk_b", column_name: "product_id", ref_table: "products" }),
    ]);
    expect(grouped.map((f) => f.name)).toEqual(["fk_a", "fk_b"]);
  });

  it("returns an empty array for a table with no foreign keys", () => {
    expect(groupForeignKeyRows([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/connections/mysql-constraints.test.ts`
Expected: FAIL — `Failed to resolve import "./mysql-constraints"`.

- [ ] **Step 3a: Extract `mysql-internal.ts`**

Move `_mysql2Mod` + `getMysql2` (`mysql.ts:5-8`), `withConn` (`:52`) and `query` (`:69`) into `src/lib/connections/mysql-internal.ts`, exporting all three, and add `import { getMysql2, withConn, query } from "./mysql-internal";` to `mysql.ts`. Change nothing else in `mysql.ts` — no signature, no body.

- [ ] **Step 3b: Prove `mysql.ts`'s public surface is unchanged**

```bash
git stash && npx tsc --noEmit --declaration --emitDeclarationOnly \
  --outDir /tmp/before src/lib/connections/mysql.ts 2>/dev/null; git stash pop
npx tsc --noEmit --declaration --emitDeclarationOnly --outDir /tmp/after src/lib/connections/mysql.ts 2>/dev/null
diff /tmp/before/**/mysql.d.ts /tmp/after/**/mysql.d.ts
```
Expected: empty diff. If `tsc` refuses on a single file in this project's config, fall back to Phase 1's technique — enumerate exports through the checker at both revisions and diff the lists. Either way, **an empty diff is required before continuing**; a widened driver surface is the one thing this extraction must not do.

- [ ] **Step 3c: Implement the two functions**

```sql
-- listConstraints
SELECT tc.CONSTRAINT_NAME AS name,
       tc.CONSTRAINT_TYPE  AS type,
       COALESCE(cc.CHECK_CLAUSE, '') AS definition
FROM information_schema.TABLE_CONSTRAINTS tc
LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
       ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
      AND cc.CONSTRAINT_NAME   = tc.CONSTRAINT_NAME
WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME
```

```sql
-- listForeignKeys
SELECT kcu.CONSTRAINT_NAME AS name,
       kcu.COLUMN_NAME     AS column_name,
       kcu.ORDINAL_POSITION AS ordinal,
       kcu.REFERENCED_TABLE_SCHEMA AS ref_schema,
       kcu.REFERENCED_TABLE_NAME   AS ref_table,
       kcu.REFERENCED_COLUMN_NAME  AS ref_column,
       rc.UPDATE_RULE AS on_update,
       rc.DELETE_RULE AS on_delete
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
     ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
    AND rc.CONSTRAINT_NAME   = kcu.CONSTRAINT_NAME
WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
```

Both functions open with the two guards the tests assert on:

```ts
validateIdentifier(database, "database name");
validateIdentifier(table, "table name");
```

`listForeignKeys` returns `groupForeignKeyRows(rows)`:

```ts
export function groupForeignKeyRows(rows: ForeignKeyRow[]): MysqlForeignKey[] {
  const byName = new Map<string, { row: ForeignKeyRow; cols: ForeignKeyRow[] }>();
  for (const r of rows) {
    const entry = byName.get(r.name);
    if (entry) entry.cols.push(r);
    else byName.set(r.name, { row: r, cols: [r] });
  }
  return [...byName.values()].map(({ row, cols }) => {
    // Sort here rather than trusting the ORDER BY: a composite key's column
    // order is part of the constraint's meaning, and this function is also
    // the unit under test, where rows arrive deliberately unsorted.
    const ordered = [...cols].sort((a, b) => a.ordinal - b.ordinal);
    return {
      name: row.name,
      columns: ordered.map((c) => c.column_name),
      refSchema: row.ref_schema,
      refTable: row.ref_table,
      refColumns: ordered.map((c) => c.ref_column),
      onUpdate: row.on_update,
      onDelete: row.on_delete,
    };
  });
}
```

`information_schema.CHECK_CONSTRAINTS` requires MySQL 8.0.16+. On older servers the `LEFT JOIN` throws `ER_NO_SUCH_TABLE`; catch that one error code and re-run without the join, with `definition: ''`. Note this in a comment — a silent empty constraints tab on MySQL 5.7 would be a support mystery.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/connections/mysql-constraints.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the route**

```ts
export const runtime = "nodejs";
// GET → { constraints, foreignKeys }
```
Same `resolve()` shape as the sibling `tables/[table]/route.ts`, `Promise.all` the two calls, `formatError` on the catch with status 502. `/api/mysql/...` is already covered by the proxy's `connectionIdFromPath` matcher (mysql is a known tech id), so no RBAC additions are needed — confirm by re-reading `src/proxy.ts` before assuming.

- [ ] **Step 6: Add the two tabs to the MySQL descriptor**

Add `constraints` and `foreign_keys` to `tabs`, fetch them from the new route, and reuse the `MetaTable` column specs the Postgres descriptor already declares (Name / Type / Definition and Name / Columns / References / On update / On delete). This is exactly the payoff the shell was built for: two new tabs, no new panel code.

- [ ] **Step 7: Extend the safety net deliberately**

Add to the MySQL characterization suite: `renders all six tabs` (replacing the existing four-tab assertion) and a test that the constraints view is not fetched until its tab opens. Route the new endpoint in the `beforeEach` mock.

- [ ] **Step 8: Add integration coverage**

In `services.integration.test.ts`, add a `mysql` describe block gated on `reachable("localhost", 3306)`, asserting `listForeignKeys` returns the seeded FK from Task 14's seed script with its columns in order.

- [ ] **Step 9: Commit**

```bash
git add src/lib/connections/mysql-constraints.ts src/lib/connections/mysql-constraints.test.ts \
        "src/app/api/mysql" "src/app/mysql" src/lib/connections/services.integration.test.ts
git commit -m "feat(mysql): introspect constraints and foreign keys, and surface them as tabs"
```

---

## Task 14: MySQL compose service, seed script, and un-fixme the e2e block

MySQL is a registered tech with a full workspace and no service in `compose.yaml`, so none of it has ever run against a real server — including everything Task 13 just added.

**Files:**
- Modify: `compose.yaml`
- Create: `seed/mysql.sh`
- Modify: `seed/all.sh`, `seed/README.md`
- Modify: `e2e/sql-workspaces.spec.ts`

- [ ] **Step 1: Add the service**

```yaml
  mysql:
    image: mysql:8.4
    environment:
      MYSQL_ROOT_PASSWORD: Baklava123!
      MYSQL_DATABASE: demo
    ports: ["3306:3306"]
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-pBaklava123!"]
      interval: 5s
      timeout: 3s
      retries: 15
```

Update the file's header comment, which currently lists only `postgres, kafka, sqlserver`.

- [ ] **Step 2: Write `seed/mysql.sh`**

Mirror `seed/postgres.sh`'s structure exactly — same header comment style, `set -euo pipefail`, env-overridable defaults, prefer a local client and fall back to `docker compose exec`, and a closing summary heredoc:

```bash
#!/usr/bin/env bash
# Seed the MySQL compose service with a demo storefront schema so the
# Baklava MySQL workspace has something interesting to browse.
#
#   bash seed/mysql.sh
#
# Idempotent: drops & recreates the `demo` database on every run.
#
# Targets the compose-bundled mysql at localhost:3306. Override
# MYSQL_HOST/PORT/USER/PASSWORD/DATABASE in the environment to seed elsewhere.

set -euo pipefail

MYSQL_HOST="${MYSQL_HOST:-localhost}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-Baklava123!}"
MYSQL_DATABASE="${MYSQL_DATABASE:-demo}"

if command -v mysql >/dev/null 2>&1; then
  MYSQL=(mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" "-p$MYSQL_PASSWORD")
elif [ -n "$(docker compose ps -q mysql 2>/dev/null)" ]; then
  MYSQL=(docker compose exec -T mysql mysql -u "$MYSQL_USER" "-p$MYSQL_PASSWORD")
else
  echo "ERROR: need either mysql in PATH or a 'mysql' service in docker compose" >&2
  exit 1
fi

echo "→ seeding mysql ${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}"

"${MYSQL[@]}" <<SQL
DROP DATABASE IF EXISTS \`${MYSQL_DATABASE}\`;
CREATE DATABASE \`${MYSQL_DATABASE}\`;
USE \`${MYSQL_DATABASE}\`;

CREATE TABLE customers (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE COMMENT 'login + contact address',
  name       VARCHAR(120) NOT NULL,
  country    CHAR(2)      NOT NULL,
  vip        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'loyalty tier flag',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customers_country (country)
) COMMENT 'storefront customers';

CREATE TABLE products (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  sku         VARCHAR(32)  NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  category    VARCHAR(60)  NOT NULL,
  price_cents INT          NOT NULL,
  stock       INT          NOT NULL DEFAULT 0,
  INDEX idx_products_category (category),
  CONSTRAINT chk_products_price CHECK (price_cents >= 0)
);

CREATE TABLE orders (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  status      ENUM('pending','paid','shipped','delivered','cancelled')
              NOT NULL DEFAULT 'pending',
  total_cents INT    NOT NULL DEFAULT 0,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_status (status),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Composite foreign key target, so the FK tab has a multi-column key to render.
CREATE TABLE order_items (
  order_id   BIGINT NOT NULL,
  line_no    INT    NOT NULL,
  product_id BIGINT NOT NULL,
  qty        INT    NOT NULL,
  unit_cents INT    NOT NULL,
  PRIMARY KEY (order_id, line_no),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id)
    REFERENCES products(id),
  CONSTRAINT chk_order_items_qty CHECK (qty > 0)
);

INSERT INTO customers (email, name, country, vip) VALUES
  ('ava@example.com','Ava Stone','US',1),
  ('noah@example.com','Noah Reyes','US',0),
  ('liam@example.com','Liam Park','GB',0),
  ('olivia@example.com','Olivia Chen','CA',1),
  ('emma@example.com','Emma Garcia','ES',0);

INSERT INTO products (sku, name, category, price_cents, stock) VALUES
  ('SKU-001','Aurora Mechanical Keyboard','Peripherals',18900,42),
  ('SKU-002','Tempest 4K Monitor 27"','Displays',59900,18),
  ('SKU-003','Nimbus Wireless Mouse','Peripherals',7900,130),
  ('SKU-004','Atlas USB-C Dock 12-in-1','Accessories',14500,65),
  ('SKU-005','Vector Studio Headphones','Audio',29900,22);

INSERT INTO orders (customer_id, status, total_cents) VALUES
  (1,'paid',26800),(2,'pending',7900),(3,'shipped',59900),
  (4,'delivered',18900),(1,'cancelled',14500);

INSERT INTO order_items (order_id, line_no, product_id, qty, unit_cents) VALUES
  (1,1,1,1,18900),(1,2,3,1,7900),
  (2,1,3,1,7900),
  (3,1,2,1,59900),
  (4,1,1,1,18900),
  (5,1,4,1,14500);

CREATE VIEW top_customers AS
SELECT c.id, c.name, c.country, c.vip,
       COUNT(o.id) AS orders,
       COALESCE(SUM(o.total_cents),0)/100.0 AS lifetime_value
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name, c.country, c.vip
ORDER BY lifetime_value DESC;
SQL

cat <<DONE
✓ mysql seeded
  database: ${MYSQL_DATABASE}
  tables:   customers, products, orders, order_items
  views:    top_customers
  rows:     5 customers · 5 products · 5 orders · 6 order items

Open the Baklava UI → MySQL workspace and expand the demo database.
DONE
```

Note the heredoc is **unquoted** (`<<SQL`, not `<<'SQL'`) so `${MYSQL_DATABASE}` interpolates; that is why the MySQL backticks are escaped as `\``. The postgres seed uses a quoted heredoc because it needs no interpolation — don't copy that detail across.

Every tab this phase touches has something to show: `AUTO_INCREMENT` and a `UNIQUE` index and column `COMMENT`s for Structure, two secondary indexes for Indexes, two `CHECK` constraints for Constraints, three foreign keys — one of them on a composite-PK table — for Foreign keys, and an `ENUM` column that exercises the row form's type detection. MySQL has no schemas, so everything lives in `demo`.

- [ ] **Step 3: Register it**

Add a `═══ mysql ═══` block to `seed/all.sh` between postgres and sqlserver, and a MySQL row to `seed/README.md`.

- [ ] **Step 4: Run it**

```bash
docker compose up -d mysql
bash seed/mysql.sh
npm run test:integration   # the mysql block from Task 13 Step 8 must now actually run
```
Expected: the mysql integration block runs and passes — no `[skip] mysql not reachable`.

- [ ] **Step 5: Un-fixme the e2e block**

In `e2e/sql-workspaces.spec.ts`: delete the `test.fixme(true, …)` line and the paragraph of header comment claiming MySQL has no compose service, and point the table navigation at the seeded `customers` table. The MySQL sidebar has a flat database→tables structure — no schema level and no "Tables" group — so its navigation is genuinely two clicks shorter than the other two blocks; do not copy the postgres click sequence.

- [ ] **Step 6: Run all three e2e blocks against real services**

Run: `npx playwright test e2e/sql-workspaces.spec.ts --reporter=list`
Expected: three blocks, three passes, none skipped. Fix selectors until true.

- [ ] **Step 7: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`

```bash
git add compose.yaml seed/ e2e/sql-workspaces.spec.ts
git commit -m "test(mysql): add the compose service, a seed script, and a real e2e run"
```

**Branch D is complete.** Merge to `main`.

---

# Branch E — `docs/roadmap-refresh`

## Task 15: Correct the roadmap and the architecture docs

`docs/ROADMAP.md` is stale in five concrete ways, all verified against the tree on 2026-08-09.

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Fix the five stale claims in `docs/ROADMAP.md`**

1. Line 3's goal sentence names only Docker, Postgres and Kafka. The catalog is **12** techs (`docker, kafka, kubernetes, minio, mongo, mysql, postgres, qdrant, r2, redis, s3, sqlserver`).
2. Line 6 says connections are in-memory. They persist to `~/.baklava/connections.json`, encrypted at rest, and there is multi-user RBAC on top.
3. Line 51's "Up next: EXPLAIN visualizer, Activity sidebar entry, Roles sidebar entry" — **all three shipped**. Move them to done and retitle "Postgres Phase 2 — DDL & ops (done)".
4. Line 55 lists Redis and MongoDB as "new techs to add". Both are registered tech modules with workspaces. Replace with what is actually outstanding: MQTT.
5. Add the genuinely-remaining ⌘K gap: command-palette coverage is **10 of 12** — `src/techs/kubernetes/meta.ts` and `src/techs/redis/meta.ts` have no `commandObjects` (verified with `grep -L commandObjects src/techs/*/meta.ts`).

- [ ] **Step 2: Add the refactor as its own roadmap phase**

A short section recording Phase 1 (driver split + safety net, done 2026-08-08), Phase 2 (this plan), and Phase 3 (query-editor convergence, deferred — see this plan's Scope section).

- [ ] **Step 3: Update `AGENTS.md`**

Three edits, each matching what Phase 2 actually changed:
- The "Postgres SQL safety" section's file list is still accurate; leave it.
- Add to "UI conventions": the shared SQL workspace primitives now live in `src/components/workspace/sql/`; new SQL workspace UI composes `SqlTableDetail` with a descriptor rather than hand-rolling a table-detail client. Name `ErrorState` as the one error surface and note the `role="alert"` + `text-destructive` contract that `e2e/sql-workspaces.spec.ts` depends on.
- Add to "UI conventions": tab strips use `useTableTabs` from `@/components/workspace/use-table-tabs`; the existing middle-click and stale-tab-pruner notes stay, since they describe the strip components, not the hook.
- Under "Run", document `bash seed/mysql.sh` and the new `mysql` compose service.

- [ ] **Step 4: Verify every claim before committing**

For each edited line, run the command that proves it (`ls src/techs/`, `grep -L commandObjects src/techs/*/meta.ts`, `ls src/app/postgres/[connectionId]/`). Phase 1's roadmap staleness happened because claims outlived their verification; do not add new ones.

- [ ] **Step 5: Commit**

```bash
git checkout -b docs/roadmap-refresh
git add docs/ROADMAP.md AGENTS.md
git commit -m "docs: correct the roadmap's stale claims and document the shared SQL workspace layer"
```

---

## Phase 2 exit criteria

1. `npm run typecheck && npm run lint && npm test && npm run build` clean on `main` after every branch merges.
2. `docker compose up -d postgres mysql sqlserver && npm run test:integration` runs with **all three** SQL blocks executing, not skipping.
3. `npx playwright test e2e/sql-workspaces.spec.ts` — three blocks, three passes, zero `fixme`, zero skips.
4. All three SQL table-detail workspaces render an `ErrorState` (not a permanent skeleton, and not an unhandled rejection) when any tab's fetch fails, with a working Retry. Covered by tests in all three characterization suites.
5. No `console.error` is tolerated by any characterization suite.
6. The three `table-detail-client.tsx` files are each **under 400 lines** (from 1637 / 1190 / 604), with the residue being descriptors, dialogs and thin references to per-tech panels. Postgres reaches this only because Task 10 extracts `StatsGrid` to a co-located `stats-grid.tsx`; that extraction is part of the criterion, not a way around it — a per-tech panel living in its own file is the intended end state, a per-tech panel living as a 271-line tail on the client is not.
7. Exactly one `row-form-dialog.tsx` exists in the tree.
8. `src/components/workspace/` and `src/components/workspace/sql/` contain no tech-specific conditionals — no `if (tech === "mysql")` anywhere in a shared primitive. Per-tech behaviour arrives through the descriptor or the dialect object.
9. SQL Server tables with a primary key offer row edit and delete; MySQL tables show Constraints and Foreign keys tabs.
10. `docs/ROADMAP.md` contains no claim contradicted by the tree.

**Not an exit criterion, deliberately:** any file-size bar phrased over `src/lib/connections/` as a directory. Phase 1's exit criterion 1 was unsatisfiable as written because `kafka.ts` is 2316 lines and was never in scope. Phase 2's size bar (criterion 6) names its three files explicitly.
