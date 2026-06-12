# Load Testing Workspace UI — Design (Plan B)

**Date:** 2026-06-12
**Status:** Approved (design); pending spec review → implementation plan
**Branch:** `feat/loadtest-ui`
**Builds on:** Plan A (backend + API, merged to main) — `/api/loadtest` CRUD + run-history + `POST [id]/run` SSE; store at `src/lib/loadtest/store.ts`; `requireLoadTest` in `src/lib/loadtest/server.ts`. And the iteration-1 engine. Parent design: `2026-06-12-loadtest-workspace-design.md` §4–5.

## Problem

The load-testing backend and API exist but have no UI. This plan makes Load Testing a
first-class Baklava feature: a home tile, a saved-tests view, a create/edit form, a
run-test workflow with live streaming progress, a results dashboard, and run history —
all consistent with Baklava's existing `WorkspaceShell` / `WorkspacePage` patterns.

## Key Decisions

| Decision | Choice |
|---|---|
| Requests in form | **Repeatable list** (add/remove/move up-down); collapsed cards expand to edit. Matches backend's N-request model from day one. |
| Live progress | **Compact status panel + collapsible raw log.** Panel shows elapsed / VUs / iterations; "Show Output" reveals the streaming k6 lines. |
| Live metrics scope (§6) | Live panel = **elapsed + VUs + iterations** (parsed from k6's status lines). **Error rate, p50/p95/p99, duration appear in the final results dashboard.** True live error-rate/percentiles (k6 `--out` streaming) is deferred. |
| Run transport | `POST /api/loadtest/[id]/run` consumed via `fetch` + `ReadableStream` reader (Plan A's SSE), with `AbortController` cancel. |
| Workspace layout | `WorkspaceShell` + sidebar sections **Config / Run / History**. |
| Engine fix | Drop `--quiet` in the k6-docker executor so k6 emits periodic newline-delimited status lines (no animated bar at `Tty:false`). |

## Non-Goals (Plan B)

Live error-rate/percentile streaming (k6 `--out`); run comparison/diff; scheduled runs;
result export; team sharing.

## Architecture

```
Home tile "Load Testing"  →  LoadTestSheet (list saved tests + New)
        │
        └─ /loadtest/[testId]  (WorkspaceShell + sidebar: Config / Run / History)
                 Config  → loadtest-form.tsx  (GET → PATCH)
                 Run     → run-client.tsx  (POST /run fetch-stream → run-progress → result-dashboard)
                 History → history-client.tsx (GET /runs → list + trend → GET /runs/[runId])
        components/loadtest/: result-dashboard, run-progress, status-pill, progress-parser
        engine fix: k6-docker.ts drop --quiet
```

### 1. Engine fix (prerequisite)

`src/lib/loadtest/executors/k6-docker.ts`: change `Cmd: ["run", "--quiet", "/work/script.js"]`
→ `Cmd: ["run", "/work/script.js"]`. No test asserts `--quiet`; the summary still arrives
via `handleSummary` on stdout. With `Tty:false`, k6 prints periodic newline-terminated
status lines to stderr (already demuxed to `onProgress`). Verify the engine integration test
(`BAKLAVA_INTEGRATION=1`) still passes and that progress lines now flow.

### 2. Registration & home tile

- `src/lib/tech-catalog.ts`: add `"Testing"` to `TechCategory` + `TECH_CATEGORIES`; add a
  `TECH_CATALOG` entry `{ id: "loadtest", name: "Load Testing", tagline, description,
  category: "Testing", color: <gradient>, status: "available" }`.
- `public/icons/loadtest.svg` — a local brand icon (icons resolve via `techIconUrl` →
  `/icons/<id>.svg`). Use a simple gauge/pulse glyph (single-color SVG; the grid applies
  `dark:brightness-0 dark:invert`).
- `src/components/tech-grid.tsx`: special-case the `loadtest` tile — clicking it opens a
  `LoadTestSheet` (new state) instead of `ConnectionSheet`; its tile count comes from a
  `GET /api/loadtest` fetch (count of saved tests), not `/api/connections`. The loadtest
  tile must not contribute to connection counts or appear in the health dashboard.

### 3. Saved tests view — `LoadTestSheet`

`src/components/loadtest-sheet.tsx` (parallel to `connection-sheet.tsx`):
- `view: "list" | "form"`, `editing: PublicLoadTest | null`.
- **List:** `GET /api/loadtest` → rows of `{ name, lastRun status pill + p95, runCount }`,
  each links to `/loadtest/[id]`; a delete (`DELETE /api/loadtest/[id]`) with confirm;
  a "New test" button → form view.
- **Form:** renders `loadtest-form.tsx` (create → `POST`, or edit → `PATCH`). `onSaved`
  returns to list and refreshes.

### 4. Workspace `/loadtest/[testId]`

- `src/app/loadtest/[testId]/layout.tsx` — `requireLoadTest(testId)` (404 if missing) →
  `WorkspaceShell` (`tech={getTech("loadtest")!}`, `connectionName={test.name}`,
  `connectionId={testId}`, `subtitle={test.config.target.baseUrl}`, sidebar = SidebarLinks
  Config / Run / History). `export const dynamic = "force-dynamic"`.
- `page.tsx` — redirect to `./config`.
- **Config** `config/page.tsx` + `config-client.tsx` — fetches the test (`GET
  /api/loadtest/[id]`, redacted) and renders `loadtest-form.tsx` in edit mode (PATCH).
- **Run** `run/page.tsx` + `run-client.tsx` — "Run test" button → `fetch(POST
  /api/loadtest/[id]/run, { signal })`; read the `ReadableStream`, split on `\n\n`, parse
  `event:`/`data:` frames into `progress` / `result` / `error` / `done`. While running:
  `<RunProgress>` (compact panel: elapsed timer client-side, VUs + iterations from
  `parseK6Progress` of the latest progress line; Cancel button aborts the controller;
  collapsible "Show Output" with the raw line log). On `result`/`done`: `<ResultDashboard>`.
  When idle, fetch the latest run (from the test's `lastRun` → `GET /runs/[runId]`) and show
  its `ResultDashboard`, plus the "Run test" button. Abort-in-flight on unmount.
- **History** `history/page.tsx` + `history-client.tsx` — `GET /api/loadtest/[id]/runs`
  (newest-first summaries): a `<Sparkline>` trend of p95 across runs (chronological), and a
  list of runs (`RelativeTime` of `startedAt`, `<StatusPill>`, p95 / rps / error%). Clicking
  a row fetches `GET /runs/[runId]` and shows its `<ResultDashboard>` (inline or a panel).

### 5. Shared components — `src/components/loadtest/`

- `result-dashboard.tsx` — pure, props `{ result: LoadTestResult }`. Metric cards: RPS,
  p50, p95, p99, error rate (%), total requests, max VUs, duration (derived from run
  start/finish or shown as the configured profile duration). Per-request table (name →
  p95 / count, from `result.requests`). Threshold list (`result.thresholds`, pass/fail).
- `run-progress.tsx` — props `{ elapsedMs, latest?: {vus?,iterations?}, lines: string[],
  onCancel }`. Compact panel + collapsible log.
- `status-pill.tsx` — props `{ status: RunStatus }` → colored badge
  (passed=emerald, failed/error=destructive, cancelled=muted, running=amber pulse).
- `progress-parser.ts` — pure `parseK6Progress(line: string) → { vus?: number;
  iterations?: number }`. Parses k6 lines like
  `running (3.0s), 02/02 VUs, 45 complete and 0 interrupted iterations`.

### 6. Form — `src/app/loadtest/loadtest-form.tsx`

Reused by `LoadTestSheet` (create) and the Config page (edit). Props
`{ initial?: PublicLoadTest; onSaved?: () => void }`.
- **Target:** `baseUrl`, optional default headers.
- **Requests:** repeatable list. Each card collapsed shows `method path`; expanded edits
  name, method (Select), path, headers (key/value rows), body (Textarea), checks
  (status number, bodyContains). Add / remove / move up / move down. List order = run order.
- **Auth:** type Select (none/bearer/basic/apiKey/customHeaders) with conditional fields.
  In edit mode, secret inputs are blank with placeholder "(unchanged — leave blank to
  keep)" (the API returns secrets masked; blank → `mergeAuth` preserves).
- **Profile:** type Select with conditional fields per variant; the `baseline`/`breakpoint`
  presets expose their few params.
- **Thresholds:** p95 / p99 (ms), error rate (0–1 or %), min RPS — all optional.
- Submit: create → `POST /api/loadtest` `{ name, config }`; edit → `PATCH
  /api/loadtest/[id]`. zod 400 errors surfaced inline. Uses shadcn (base-ui) primitives.

### 7. Data flow

`LoadTestSheet` (GET list) → `/loadtest/[id]` → Config (GET/PATCH) · Run (POST /run
fetch-stream → progress/result/error/done) · History (GET /runs, GET /runs/[runId]).

### 8. Error handling

- Form: client validation + server zod `400` shown inline.
- Run: `error` SSE event → message shown in the run panel; run persisted `error` (Plan A).
- Docker unavailable / image pull failure → `error` event with a clear message.
- Cancel → abort the `fetch` controller → server aborts → run persisted `cancelled`.
- SSE/stream client: store the controller in a ref; abort on unmount (Baklava convention).
- `RelativeTime` used for timestamps (avoids SSR/CSR `Date.now()` mismatch).

### 9. Testing

- **Unit (vitest):** `progress-parser` (k6 line variants → vus/iterations).
- **Client (happy-dom):** `result-dashboard` renders all metric cards + per-request rows +
  thresholds from a fixture `LoadTestResult`; `status-pill` color per status.
- **Engine:** the `--quiet` removal verified by the existing `BAKLAVA_INTEGRATION` test
  (run still completes; a quick assertion that progress lines are non-empty may be added).
- **Build/lint/typecheck** gates. Playwright e2e smoke optional.

### 10. Scope Boundary

**In:** engine `--quiet` fix; catalog "Testing" + tile + icon; `tech-grid` branch;
`LoadTestSheet`; `/loadtest/[testId]` workspace (layout + Config/Run/History); full
multi-request form; run streaming with compact panel + collapsible log; result dashboard;
history list + p95 trend sparkline; shared components + progress parser.

**Out (later):** live error-rate/percentile streaming (k6 `--out`); run comparison/diff;
scheduled runs; result export.

## Open Items for the Plan (not blockers)

- The `loadtest.svg` icon glyph (a simple inline gauge/zap SVG authored in the plan).
- `WorkspaceShell` renders a `RecordVisit connectionId` (command-palette recents) — passing
  `testId` is harmless; confirm during the plan whether to suppress it for loadtest.
- Exact `tech-grid` seam for the loadtest count + sheet branch (keep the change minimal and
  not entangle the existing connection-count effect).
- `result-dashboard` "duration": derive from run `startedAt`/`finishedAt` (wall-clock) vs the
  configured profile duration — decide in the plan (wall-clock from the run record is simplest).
