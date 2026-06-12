# Load-Testing Engine — Design (Iteration 1)

**Date:** 2026-06-11
**Status:** Approved (design); pending spec review → implementation plan
**Scope:** Iteration 1 only — reusable core engine + CLI adapter. UI is designed-for, not built.

## Problem

Baklava needs a way to load-test arbitrary REST APIs. The longer-term goal is a
convenient in-console load-testing experience, but the immediate need is a
**reusable, UI-independent TypeScript engine** that wraps a proven load generator
(k6) and produces structured results.

This iteration targets two of the four eventual goals:

1. **Baseline capacity** — how much steady load a target API sustains within
   latency/error thresholds.
2. **Breaking point** — ramp load until thresholds break, to find where and how
   the target degrades.

Deferred goals (later iterations): CI regression gating, driver-specific load
tests.

## Non-Goals (Iteration 1)

- No Baklava UI workspace / SSE route (designed-for, not built).
- No CI threshold-gating workflow.
- No alternative executors (only k6).
- No non-HTTP(S) protocols (no gRPC/WebSocket/Kafka load).
- No distributed / k6 Cloud execution.
- This is **not** a Postgres- or Baklava-endpoint-specific benchmark. The engine
  targets arbitrary REST APIs.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Form factor | Reusable TS library module in `src/lib/loadtest/` | Decoupled from UI; foundation for both CLI and future Baklava UI. |
| Execution backend | **k6**, wrapped behind an `Executor` interface | Leverage a proven engine; own the DX around it; keep a seam for alternatives. |
| k6 runtime | Official `grafana/k6` **Docker image** via `dockerode` | No local k6 install; portable across machines + CI. `dockerode` is already a dependency. |
| Iteration-1 deliverables | Core engine **+** CLI adapter | CLI exercises the full core and pre-stages CI gating (goal #3). |

## Architecture

```
Core Engine  (src/lib/loadtest/)        ← pure TS, no UI, no Next coupling
   └─ CLI Adapter  (scripts/loadtest.ts)
        └─ Baklava UI Integration  (later iteration — designed-for, not built)
```

The UI is only ever a consumer of the same `runLoadTest()` entry point and
`LoadTestResult` shape. Nothing in the core assumes a browser.

### Core engine modules (`src/lib/loadtest/`)

#### `schema.ts` — zod-validated `LoadTestConfig`

- `target`: `{ baseUrl: string; headers?: Record<string,string> }`.
- `requests[]`: ordered scenario steps. Each:
  - `name` (string) — becomes the per-endpoint metric tag.
  - `method`, `path`, `headers?`, `body?`.
  - `checks?` — expected status and/or body-contains assertions.
  - `weight?`, `thinkTime?` (optional pacing).
- `auth`: discriminated union — `none | bearer | basic | apiKey | customHeaders`.
  - Tokens/passwords reference **env var names**, resolved at script-gen time, so
    secrets never get hardcoded into a generated/committed script.
- `profile`: discriminated union mapped to k6 executors:
  - `constant` (vus, duration) → `constant-vus`
  - `ramping` (stages[{target, duration}]) → `ramping-vus`
  - `constantRate` (rate, duration, preallocatedVUs) → `constant-arrival-rate`
  - `rampingRate` (stages of target rate) → `ramping-arrival-rate`
  - **Presets** matching iteration-1 goals:
    - `baseline` — steady load to find sustainable RPS within thresholds.
    - `breakpoint` — ramp until thresholds break.
- `thresholds`: e.g. `p95 < 500ms`, `errorRate < 1%`, `minRps`. Mapped to k6
  `thresholds`.

#### `script-gen.ts` — `config → k6 script string` (pure)

Templates k6 `options` (scenarios/executors/thresholds) plus a default function
that loops over `requests`, injects resolved auth, runs `check()`s, and tags
metrics per request `name`. Pure function → directly unit-testable.

#### `executor.ts` — `Executor` interface

```ts
interface Executor {
  run(script: string, opts: RunOpts, onProgress: (p: Progress) => void): Promise<RawRunOutput>;
  cancel(): void;
}
```

This is the seam alternative backends slot into later.

#### `executors/k6-docker.ts` — k6 via dockerode

- Runs `grafana/k6`; the generated script is piped to `k6 run -` over **stdin**
  (no script files written to the repo / mounted).
- `--summary-export` writes summary JSON to a **bind-mounted temp results dir**.
- Container stdout captured as a **hijacked stream** for live progress.
- Pulls the image if missing (reuse existing image-pull pattern).
- Destroys the container on abort (existing dockerode stream-lifecycle
  discipline: `stream.destroy?.()` on `req.signal.abort`-equivalent cancel).

#### `results.ts` — parse k6 summary → `LoadTestResult`

Stable result shape, independent of k6's JSON format:

- Latency: p50 / p90 / p95 / p99 / max.
- Throughput: total requests + RPS.
- Error rate, VUs, data sent / received.
- **Per-request breakdown** via tags.
- Threshold pass/fail list + overall `passed: boolean`.
- `startedAt` / `endedAt`, echoed config.

#### `run-load-test.ts` — orchestrator

`runLoadTest(config) → LoadTestResult`: validate (zod) → generate script →
select executor → execute → parse. Emits progress events
(async-iterable / emitter) consumable by both the CLI and a future SSE route.

### CLI adapter (`scripts/loadtest.ts`)

- Reads a config file (TS or JSON).
- Calls `runLoadTest`, streams a live progress line to the terminal.
- Prints a summary table.
- **Exits non-zero when thresholds fail** — the seam goal #3 (CI regression
  gating) plugs into later.

## Data Flow

```
config
  → zod validate
  → script-gen
  → k6-docker executor (dockerode runs grafana/k6; script via stdin; summary via mounted dir)
  → stdout (live progress) + summary.json (final)
  → results parser
  → LoadTestResult
  → consumer (CLI now / SSE → UI later)
```

## Error Handling

- **Config**: zod validation with clear, field-level messages.
- **Docker unavailable / image absent**: detect, pull `grafana/k6`, wrap failures
  with `formatError` (from `src/lib/errors.ts`).
- **Threshold breach is not an engine error**: k6's threshold-fail exit code (99)
  is translated to `result.passed = false`, not a thrown error. Only genuine k6 /
  Docker failures throw.
- **localhost targets**: rewrite `localhost` / `127.0.0.1` →
  `host.docker.internal` (with `extra_hosts`) so the container can reach
  host-run APIs. Documented behavior.
- **Cleanup**: temp results dir + container removed in `finally`; `cancel()`
  stops/removes the container.

## Testing

- **Unit (vitest, pure/fast):**
  - `script-gen`: config → expected k6 script snippets.
  - `results`: fixture summary.json → `LoadTestResult`.
  - `schema`: validation success/failure cases.
  - profile → k6 executor mapping.
- **Integration (gated behind `BAKLAVA_INTEGRATION`, matching existing setup):**
  - Real `grafana/k6` container against a throwaway local HTTP server; assert
    result shape and threshold pass/fail behavior.

## Iteration-1 Scope Boundary

**In:** `schema`, `script-gen`, `k6-docker` executor, `results` parser,
`run-load-test` orchestrator with progress events, CLI adapter,
`baseline` + `breakpoint` profile presets, unit tests + one integration test.

**Out (later iterations):** Baklava UI workspace + SSE route, CI threshold-gating
workflow, alternative executors, non-HTTP protocols, distributed / cloud k6.

## Future Iterations (context, not committed)

1. **CI regression gating** — wrap the CLI's non-zero-on-failure behavior in a
   workflow; store/compare baselines.
2. **Baklava UI workspace** — form to define target/requests/profile/thresholds;
   API route calls `runLoadTest`; SSE streams progress (reuse the documented SSE
   pattern); results rendered with dashboard-style components (sparklines /
   HealthCard).
3. **Driver-specific load tests** — targeted scenarios for the driver layer
   (e.g. the per-call `pg.Client` gap, Kafka ephemeral consumer groups).
4. **Alternative executors** behind the same `Executor` interface, if needed.
