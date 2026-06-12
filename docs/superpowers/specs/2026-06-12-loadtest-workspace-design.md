# Load Testing Workspace — Design (Iteration 2)

**Date:** 2026-06-12
**Status:** Approved (design); pending spec review → implementation plan
**Builds on:** the iteration-1 load-testing engine (`src/lib/loadtest/`, k6 via the `grafana/k6` Docker image). See `2026-06-11-load-testing-engine-design.md`.

## Problem

The load-testing engine exists as a reusable library + CLI. This iteration makes it a
**first-class, user-facing feature** in the Baklava console: a dedicated Load Testing
workspace where a user defines REST API targets, configures requests / auth / load
profiles / thresholds, runs tests from the UI with live progress, sees structured
metrics, and saves & reuses test configurations with a persisted run history.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Domain model | **Own store / persistence / lifecycle**, reuse UI infrastructure | A saved load test is a reusable test definition, not a connection to a live backend. Don't pollute the connection/health-dashboard model; do reuse `WorkspaceShell`/`WorkspacePage`/Sheet/home-tile. |
| Run history | **Persisted** per test | Enables trend/compare and sets up the later CI/regression goal. |
| Secrets | **Stored at rest reusing the connection password pattern** | Best save-&-reuse UX. NB: that pattern is *not* encryption — it's a `0600` file + redact-on-API + "(unchanged — leave blank to keep)" merge (plaintext on disk, like `connections.json`). Matching the codebase's real posture, not adding new crypto. |
| Run lifecycle | **Tied to the page (SSE)** | Closing/navigating aborts the run (k6 container removed). Matches existing streaming ops; no background run registry. |
| Run transport (A) | **POST consumed via `fetch` + `ReadableStream` reader** (not `EventSource`) | Starting a run is a mutation; `fetch` gives clean `AbortController` cancellation. Deliberate deviation from the `EventSource` convention. |
| Workspace layout (B) | **`WorkspaceShell` + sidebar sections** (Config / Run / History) | Consistent with every other Baklava workspace. |
| Engine changes | **None** | A pure translator maps UI literal-secret auth → engine env-name auth + an env map, preserving the engine's "secrets flow as container env, never in script" property. |

## Non-Goals (Iteration 2)

- CI gating / regression workflow.
- Driver-specific load scenarios.
- Scheduled / cron runs.
- Distributed / multi-region execution.
- Trend charts or run-diffing beyond a chronological history list.
- Team sharing / RBAC.
- Background runs that survive navigation (explicitly ruled out — runs are page-tied).

## Architecture

```
Home tile "Load Testing"  →  LoadTestSheet (list saved tests + new form)
        │
        └─ /loadtest/[id]  (WorkspaceShell + sidebar: Config / Run / History)
                 │  Config → loadtest-form.tsx
                 │  Run    → run-client.tsx  (POST fetch-stream → live progress + result)
                 │  History→ runs list → run detail
                 ▼
        API: /api/loadtest[...]  (CRUD + runs + POST run-and-stream)
                 ▼
        store.ts (baklava.loadtestStore → ~/.baklava/loadtests.json, 0600, redact-on-API)
                 │  toEngineConfig() translator
                 ▼
        engine: runLoadTest()  (src/lib/loadtest, UNCHANGED)  → k6 Docker
```

### 1. Store & persistence — `src/lib/loadtest/store.ts` (server-only)

Mirrors `src/lib/connections/store.ts`:

- `globalThis[Symbol.for("baklava.loadtestStore")]` holding all saved tests; persisted to
  `~/.baklava/loadtests.json` (mode `0600`, honors `BAKLAVA_DATA_DIR`); loaded on first
  `getStore()` after process restart.
- **Entities:**
  - `LoadTest { id, name, config: SavedLoadTestConfig, createdAt, updatedAt }`
  - `LoadTestRun { id, startedAt, finishedAt?, status, result?, error? }` where
    `status ∈ { "running", "passed", "failed", "error", "cancelled" }`. Stored as a
    per-test array `runs: LoadTestRun[]`.
- **History cap:** keep the most recent 50 runs per test; prune older on `appendRun`.
- **Secrets:** `SavedLoadTestConfig.auth` holds literal secret values. Persisted at rest the
  same way connections are — plaintext in a `0600` file (NOT encrypted; the cited connection
  pattern does not encrypt either). A purpose-built redact/merge for the auth union: API
  responses go through `redactLoadTest`/`publicView` so secrets never leave the server; PATCH
  preserves an existing secret when the field is blank (the "(unchanged — leave blank to
  keep)" merge).
- **Functions:** `getLoadTest`, `listLoadTests`, `saveLoadTest`, `updateLoadTest`
  (secret-preserving merge), `deleteLoadTest`, `appendRun`, `listRuns`, `getRun`,
  `redactLoadTest`. A `requireLoadTest(id)` helper (server) for layouts (404 if missing).

### 2. Saved-config schema & engine translation

- `SavedLoadTestConfig` (zod) reuses the engine's `requestStepSchema`, `profileSchema`,
  `thresholdsSchema`, but uses a **UI auth model with literal values**:
  `none | bearer{token} | basic{username,password} | apiKey{header,value} |
  customHeaders{headers: Record<string,string>}`.
- `toEngineConfig(saved): { config: LoadTestConfig, env: Record<string,string> }` — pure
  translator. For each secret it assigns a synthetic env var name (e.g. `LT_BEARER`,
  `LT_BASIC_USER`/`LT_BASIC_PASS`, `LT_APIKEY`, `LT_CUSTOM_<HEADER>`), produces the engine's
  env-name auth form, and returns the value map for `runLoadTest`'s `opts.env`. Non-secret
  fields (target, requests, profile, thresholds) pass through unchanged.
- This keeps the engine untouched and preserves its property that secrets reach k6 only as
  container env, never embedded in the generated script.

### 3. API routes — `src/app/api/loadtest/` (`runtime="nodejs"`, `formatError`)

- `GET /api/loadtest` — list saved tests (redacted public view).
- `POST /api/loadtest` — create (validate `SavedLoadTestConfig`, save).
- `GET /api/loadtest/[id]` — get one (redacted).
- `PATCH /api/loadtest/[id]` — update (secret-preserving merge).
- `DELETE /api/loadtest/[id]` — delete the test and its run history.
- `GET /api/loadtest/[id]/runs` — list run history (summaries).
- `GET /api/loadtest/[id]/runs/[runId]` — one run's full `LoadTestResult`.
- `POST /api/loadtest/[id]/run` — **start + stream** a run:
  1. Load + validate the saved test; `toEngineConfig`.
  2. Create a `LoadTestRun` (status `running`) and append it.
  3. Open a `ReadableStream` (documented SSE pattern + 15s heartbeat). Call engine
     `runLoadTest(config, { env, onProgress, signal })`. Wire `onProgress` → `event: progress`.
     On success → `event: result` (the `LoadTestResult`) then `event: done`; persist the run
     with status `passed`/`failed` (from `result.passed`) + result.
  4. On engine throw → `event: error` (message via `formatError`); persist status `error`.
  5. `req.signal` abort → engine `AbortSignal` (container removed); persist status `cancelled`.
  Wire format `event: <name>\ndata: <json>\n\n`.

### 4. UI

- **Home tile:** add a `TECH_CATALOG` entry `loadtest` (name "Load Testing", new category
  `"Testing"`, `status: "available"`). The home grid special-cases this tile so clicking it
  opens a `LoadTestSheet` (parallel to `ConnectionSheet`) rather than the connection sheet —
  it is not a connection tech and must not appear in connection counts or the health dashboard.
- **`LoadTestSheet`** (`src/app/loadtest/loadtest-sheet.tsx` or under components): list saved
  tests (from `GET /api/loadtest`), each row links to `/loadtest/[id]`; a "New test" view
  renders `loadtest-form.tsx`. List ⇄ form toggle, mirroring `ConnectionSheet`.
- **Workspace `/loadtest/[id]`:**
  - `layout.tsx` — `requireLoadTest(id)` (404 if missing) → `<WorkspaceShell tech="loadtest"
    connectionName={name} sidebar={…Config/Run/History SidebarLinks}>`.
  - **Config** page — `loadtest-form.tsx` (reused by the Sheet for create and the workspace
    for edit): target `baseUrl`; repeatable requests builder (name, method, path, headers,
    body, checks {status, bodyContains}, thinkTime); auth-type selector with conditional
    fields; profile selector (constant/ramping/constantRate/rampingRate/baseline/breakpoint)
    with conditional fields; thresholds (p95/p99/errorRate/minRps). Secrets render
    "(unchanged — leave blank to keep)" in edit mode. Saves via POST (create) / PATCH (edit).
  - **Run** page — `run-client.tsx` (`"use client"`): "Run test" button → `fetch(POST
    /run, { signal })`, read the `ReadableStream`, parse SSE events; show a live k6 progress
    log and running status; on `done`, render the result panel. "Cancel" aborts the
    `AbortController`. Abort-in-flight cleanup on unmount (per Baklava convention).
  - **History** page — runs list (started time via `RelativeTime`, status pill, p95, rps,
    error%); clicking a run shows its full metrics (reuse the result panel).

### 5. Results visualization

A shared result panel (`src/components/loadtest/` or reuse `src/components/`): latency cards
(p50/p95/p99/max), RPS, error-rate, max VUs; an overall pass/fail pill; a per-request table
(name → p95 / count); a thresholds pass/fail list. Reuse the dashboard's `Sparkline` /
`HealthCard` styling where it fits. Driven entirely by the engine's `LoadTestResult`.

### 6. Error handling

- `formatError` throughout.
- zod validation failure on create/update → `400` with field-level messages.
- Missing test → `404` (`requireLoadTest`).
- Docker unavailable / image pull failure → surfaced as an `error` SSE event (the engine
  already wraps these); the Run UI shows the message, run persisted as `error`.
- Abort → run persisted as `cancelled`; the container is removed by the engine's abort path.

### 7. Testing

- **Unit (vitest `server`, fast):**
  - store CRUD; secret redaction; secret-preserving merge on blank; history pruning (cap 50);
  - `toEngineConfig` translator (each auth type → correct env-name auth + env map; non-secret
    passthrough);
  - `SavedLoadTestConfig` schema validation (valid + rejection cases).
- **API (matching existing `src/app/api/**` test style):** list/create/get/patch/delete +
  validation + redaction; run route's **non-Docker** logic (run-record creation, translation
  call, error→`error`-event mapping) with the engine executor stubbed/injected.
- **Docker path:** already covered by the engine's `BAKLAVA_INTEGRATION` integration test;
  not re-tested here.
- **Client:** a Playwright smoke test (existing e2e setup) is optional for v1.

### 8. Scope Boundary

**In:** store/persistence/secrets, `toEngineConfig` translator, CRUD API, run-and-stream SSE
wired to the engine, home tile + `LoadTestSheet`, `/loadtest/[id]` workspace
(Config/Run/History), results visualization, persisted run history.

**Out (later iterations):** CI gating, driver-specific scenarios, scheduled runs, distributed
execution, trend charts / run-diffing, team sharing.

## Files (anticipated)

- `src/lib/loadtest/store.ts` — stateful store + persistence + secrets + history.
- `src/lib/loadtest/store-schema.ts` — `SavedLoadTestConfig` zod schema (UI auth model).
- `src/lib/loadtest/to-engine-config.ts` — pure translator.
- `src/lib/loadtest/server.ts` — `requireLoadTest` (server-only).
- `src/app/api/loadtest/route.ts`, `[id]/route.ts`, `[id]/runs/route.ts`,
  `[id]/runs/[runId]/route.ts`, `[id]/run/route.ts`.
- `src/app/loadtest/loadtest-form.tsx`, `loadtest-sheet.tsx`,
  `[connectionId]/layout.tsx` + `config`, `run`, `history` pages and `*-client.tsx` siblings.
  (Route param name follows the existing `[connectionId]` convention or a `[testId]` analog —
  to be finalized in the plan; the workspace shell expects a single id segment.)
- `src/components/loadtest/*` — result panel + run progress log.
- Catalog/registration: `TECH_CATALOG` entry; home-grid + sheet special-casing.

## Open Items for the Plan (not blockers)

- Exact route-segment name (`[testId]` vs reusing `[connectionId]`) and how `WorkspaceShell`
  accepts a non-connection entity (it currently takes `connectionName`/`tech`).
- Whether `SECRET_KEYS` is extended or a parallel load-test secret-key list is introduced
  (the auth shape differs from connection configs).
- Home-grid integration: the cleanest seam to branch the `loadtest` tile to `LoadTestSheet`
  without entangling connection counts / health-dashboard filtering.
