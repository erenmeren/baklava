# Load Testing Workspace UI Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Load Testing workspace UI in Baklava — home tile, saved-tests sheet, multi-request create/edit form, run workflow with live streaming progress, results dashboard, and run history — over the existing `/api/loadtest` backend, reusing `WorkspaceShell`/`WorkspacePage` patterns.

**Architecture:** A `loadtest` entry in `TECH_CATALOG` (new "Testing" category) whose home tile opens a `LoadTestSheet` (parallel to `ConnectionSheet`). Each saved test gets a `/loadtest/[testId]` workspace (`WorkspaceShell` + sidebar Config/Run/History). Pure helpers (`parseK6Progress`, form serialization, SSE frame parsing) are unit-tested; presentational components (`result-dashboard`, `status-pill`) get happy-dom render tests; pages/clients are wired per Baklava convention and verified by typecheck/build. The engine drops `--quiet` so k6 streams periodic status lines.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, shadcn/base-ui components in `src/components/ui/`, vitest (`server` + `client` projects), the Plan-A `/api/loadtest` API.

> **Type imports:** The UI imports TYPES only from server modules via `import type` (erased at build — safe): `PublicLoadTest`, `RunSummary`, `RunStatus`, `LoadTestRun` from `@/lib/loadtest/store`; `SavedLoadTestConfig`, `SavedAuth` from `@/lib/loadtest/store-schema`; `LoadProfile`, `RequestStep` from `@/lib/loadtest/schema`; `LoadTestResult` from `@/lib/loadtest/results`. Never import their VALUES into a client component (`store.ts` uses `node:fs`).

---

## File Structure (Plan B)

| File | Responsibility |
|---|---|
| `src/lib/loadtest/executors/k6-docker.ts` (modify) | Drop `--quiet` so k6 streams progress. |
| `src/lib/loadtest/progress-parser.ts` | Pure `parseK6Progress(line)` → `{vus?,iterations?}`. |
| `src/lib/tech-catalog.ts` (modify) | "Testing" category + `loadtest` catalog entry. |
| `public/icons/loadtest.svg` | Tile/brand icon. |
| `src/components/tech-grid.tsx` (modify) | Branch the `loadtest` tile → `LoadTestSheet` + its count. |
| `src/components/loadtest/status-pill.tsx` | Run-status badge. |
| `src/components/loadtest/result-dashboard.tsx` | Metric cards + per-request table + thresholds. |
| `src/components/loadtest/run-progress.tsx` | Compact status panel + collapsible log. |
| `src/components/loadtest-sheet.tsx` | Saved-tests list ⇄ form sheet. |
| `src/components/loadtest-list.tsx` | The saved-tests list rows. |
| `src/app/loadtest/form-serialize.ts` | Pure form-state ⇄ `SavedLoadTestConfig`. |
| `src/app/loadtest/loadtest-form.tsx` | Create/edit form (orchestrator). |
| `src/app/loadtest/request-card.tsx` | One request editor (collapsed/expanded). |
| `src/app/loadtest/auth-fields.tsx` | Conditional auth inputs. |
| `src/app/loadtest/profile-fields.tsx` | Conditional profile inputs. |
| `src/app/loadtest/[testId]/layout.tsx` | WorkspaceShell + sidebar. |
| `src/app/loadtest/[testId]/page.tsx` | Redirect → `./config`. |
| `src/app/loadtest/[testId]/config/{page,config-client}.tsx` | Edit form. |
| `src/app/loadtest/[testId]/run/{page,run-client}.tsx` + `sse.ts` | Run workflow + SSE parse. |
| `src/app/loadtest/[testId]/history/{page,history-client}.tsx` | History list + trend. |

Branch `feat/loadtest-ui` (already created).

---

## Task 1: Engine `--quiet` fix

**Files:**
- Modify: `src/lib/loadtest/executors/k6-docker.ts`

- [ ] **Step 1: Make the change**

In `src/lib/loadtest/executors/k6-docker.ts`, find the `createContainer` call's `Cmd` (currently `Cmd: ["run", "--quiet", "/work/script.js"],`) and change it to:

```ts
        Cmd: ["run", "/work/script.js"],
```

Rationale: with `Tty: false`, k6 prints periodic newline-terminated status lines to stderr (no animated bar). These are already demuxed to `onProgress`. `--quiet` suppressed them.

- [ ] **Step 2: Verify unit suite unaffected**

Run: `npx vitest run src/lib/loadtest`
Expected: PASS (no unit test asserts `--quiet`).

- [ ] **Step 3: (Docker available) Verify progress now streams**

Run: `BAKLAVA_INTEGRATION=1 npx vitest run --project=integration src/lib/loadtest/executors/k6-docker.integration.test.ts`
Expected: PASS (summary still parsed via stdout markers; the run completes).

- [ ] **Step 4: Commit**

```bash
git add src/lib/loadtest/executors/k6-docker.ts
git commit -m "fix(loadtest): drop k6 --quiet so live progress streams"
```

---

## Task 2: k6 progress parser (`progress-parser.ts`)

**Files:**
- Create: `src/lib/loadtest/progress-parser.ts`
- Test: `src/lib/loadtest/progress-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/progress-parser.test.ts
import { describe, it, expect } from "vitest";
import { parseK6Progress } from "./progress-parser";

describe("parseK6Progress", () => {
  it("extracts VUs and iteration count from a running line", () => {
    const line = "running (3.0s), 02/02 VUs, 45 complete and 0 interrupted iterations";
    expect(parseK6Progress(line)).toEqual({ vus: 2, iterations: 45 });
  });

  it("extracts from a ramping line with different VU counts", () => {
    expect(parseK6Progress("running (10.5s), 08/20 VUs, 312 complete and 1 interrupted iterations"))
      .toEqual({ vus: 8, iterations: 312 });
  });

  it("returns an empty object for non-progress lines", () => {
    expect(parseK6Progress("some other log line")).toEqual({});
    expect(parseK6Progress("")).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/progress-parser.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/loadtest/progress-parser.ts

/**
 * Parse a k6 periodic status line (emitted to stderr when not --quiet and not a
 * TTY), e.g. "running (3.0s), 02/02 VUs, 45 complete and 0 interrupted iterations".
 * Returns the current active VU count and completed-iteration count when present.
 */
export function parseK6Progress(line: string): { vus?: number; iterations?: number } {
  const out: { vus?: number; iterations?: number } = {};
  const vus = line.match(/(\d+)\/(\d+)\s+VUs/);
  if (vus) out.vus = Number(vus[1]);
  const iters = line.match(/(\d+)\s+complete/);
  if (iters) out.iterations = Number(iters[1]);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/progress-parser.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/progress-parser.ts src/lib/loadtest/progress-parser.test.ts
git commit -m "feat(loadtest): pure k6 progress-line parser"
```

---

## Task 3: Catalog registration + icon + tech-grid branch

**Files:**
- Modify: `src/lib/tech-catalog.ts`
- Create: `public/icons/loadtest.svg`
- Modify: `src/components/tech-grid.tsx`
- Test: `src/lib/tech-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tech-catalog.test.ts
import { describe, it, expect } from "vitest";
import { TECH_CATALOG, TECH_CATEGORIES, getTech } from "./tech-catalog";

describe("loadtest catalog entry", () => {
  it("registers a Load Testing tech in the Testing category", () => {
    const lt = getTech("loadtest");
    expect(lt).toBeDefined();
    expect(lt?.name).toBe("Load Testing");
    expect(lt?.category).toBe("Testing");
    expect(lt?.status).toBe("available");
  });

  it("includes Testing in the category list", () => {
    expect(TECH_CATEGORIES).toContain("Testing");
  });

  it("loadtest appears exactly once in the catalog", () => {
    expect(TECH_CATALOG.filter((t) => t.id === "loadtest")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tech-catalog.test.ts`
Expected: FAIL (loadtest undefined / "Testing" missing).

- [ ] **Step 3: Edit `src/lib/tech-catalog.ts`**

Add `"Testing"` to the `TechCategory` union:
```ts
export type TechCategory =
  | "Runtime"
  | "Database"
  | "Streaming"
  | "Orchestration"
  | "Cache"
  | "Storage"
  | "Testing";
```
Add `"Testing"` to `TECH_CATEGORIES` (before the closing `] as const;`, after `"Storage",`):
```ts
  "Testing",
```
Append a catalog entry to the end of the `TECH_CATALOG` array (before its closing `];`):
```ts
  {
    id: "loadtest",
    name: "Load Testing",
    tagline: "k6 load tests",
    description: "Define, run, and track HTTP load tests against any REST API with k6.",
    category: "Testing",
    color: "from-amber-400 to-orange-600",
    status: "available",
  },
```

- [ ] **Step 4: Create `public/icons/loadtest.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a9 9 0 1 0-9-9"/><path d="M12 12l4-2.5"/><path d="M3 12h2"/><path d="M12 3v2"/><path d="M5.6 5.6l1.4 1.4"/></svg>
```
(A gauge glyph. The grid renders it with `dark:brightness-0 dark:invert`; `currentColor` strokes are fine.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/tech-catalog.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Branch the tile in `src/components/tech-grid.tsx`**

Add the loadtest sheet import near the top (after the `ConnectionSheet` import):
```ts
import { LoadTestSheet } from "@/components/loadtest-sheet";
```
Add state next to `const [openTech, setOpenTech] = useState<TechMeta | null>(null);`:
```ts
  const [loadtestOpen, setLoadtestOpen] = useState(false);
```
In the counts `load()` effect, after the connections loop that builds `next`, also fetch the loadtest count (inside the same `try`, before `setCounts(next)`):
```ts
        try {
          const ltRes = await fetch("/api/loadtest", { cache: "no-store" });
          if (ltRes.ok) {
            const ltData = (await ltRes.json()) as { loadtests: unknown[] };
            next.loadtest = ltData.loadtests.length;
          }
        } catch {
          // ignore
        }
```
In the tile `onClick` for available techs, branch loadtest. Replace the available-tile `<button ... onClick={() => setOpenTech(tech)} ...>` so its handler is:
```ts
              onClick={() => (tech.id === "loadtest" ? setLoadtestOpen(true) : setOpenTech(tech))}
```
Finally, render the sheet alongside `<ConnectionSheet ... />`:
```tsx
      <LoadTestSheet open={loadtestOpen} onOpenChange={setLoadtestOpen} />
```

> Note: `LoadTestSheet` is built in Task 7. Until then this import won't resolve. Implement Task 3's catalog+icon+test now and COMMIT only the catalog/icon (Steps 3–5); defer the tech-grid edits (Step 6) to be committed together with Task 7 so the branch never has a broken import. (The tech-grid changes are listed here for context; do them in Task 7.)

- [ ] **Step 7: Commit (catalog + icon only)**

```bash
git add src/lib/tech-catalog.ts src/lib/tech-catalog.test.ts public/icons/loadtest.svg
git commit -m "feat(loadtest): catalog 'Testing' category + Load Testing tile icon"
```

---

## Task 4: Display components — `status-pill.tsx`, `result-dashboard.tsx`

**Files:**
- Create: `src/components/loadtest/status-pill.tsx`
- Create: `src/components/loadtest/result-dashboard.tsx`
- Test: `src/components/loadtest/result-dashboard.dom.test.tsx`

- [ ] **Step 1: Create `src/components/loadtest/status-pill.tsx`**

```tsx
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/loadtest/store";

const STYLES: Record<RunStatus, string> = {
  running: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  passed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  error: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function StatusPill({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        STYLES[status],
      )}
    >
      {status === "running" ? <span className="size-1.5 rounded-full bg-amber-500 status-pulse" /> : null}
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Write the failing dom test**

```tsx
// src/components/loadtest/result-dashboard.dom.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultDashboard } from "./result-dashboard";
import type { LoadTestResult } from "@/lib/loadtest/results";

const RESULT: LoadTestResult = {
  name: "demo",
  passed: false,
  latency: { avg: 100, min: 10, p50: 90, max: 400, p90: 150, p95: 220, p99: 350 },
  totalRequests: 1234,
  rps: 205.5,
  errorRate: 0.012,
  vusMax: 10,
  dataSent: 5000,
  dataReceived: 90000,
  requests: [{ name: "list", latency: { p95: 219 } }],
  thresholds: [
    { name: "http_req_duration: p(95)<200", passed: false },
    { name: "http_req_failed: rate<0.01", passed: false },
  ],
};

describe("ResultDashboard", () => {
  it("renders headline metrics", () => {
    render(<ResultDashboard result={RESULT} />);
    expect(screen.getByText("1234")).toBeInTheDocument(); // total requests
    expect(screen.getByText("205.5")).toBeInTheDocument(); // rps
    expect(screen.getByText("220")).toBeInTheDocument(); // p95
    expect(screen.getByText("1.20%")).toBeInTheDocument(); // error rate
  });

  it("renders per-request rows and thresholds", () => {
    render(<ResultDashboard result={RESULT} />);
    expect(screen.getByText("list")).toBeInTheDocument();
    expect(screen.getByText("http_req_duration: p(95)<200")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/loadtest/result-dashboard.dom.test.tsx`
Expected: FAIL — cannot find module `./result-dashboard`.

- [ ] **Step 4: Create `src/components/loadtest/result-dashboard.tsx`**

```tsx
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { LoadTestResult } from "@/lib/loadtest/results";

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-xs text-muted-foreground mt-0.5">{sub}</div> : null}
    </Card>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function ResultDashboard({ result }: { result: LoadTestResult }) {
  const errorPct = `${(result.errorRate * 100).toFixed(2)}%`;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <Metric label="Requests" value={String(result.totalRequests)} />
        <Metric label="RPS" value={result.rps.toFixed(1)} />
        <Metric label="Error rate" value={errorPct} />
        <Metric label="Max VUs" value={String(result.vusMax)} />
        <Metric label="p50" value={`${result.latency.p50}ms`} />
        <Metric label="p95" value={`${result.latency.p95}ms`} />
        <Metric label="p99" value={`${result.latency.p99}ms`} />
        <Metric label="Max" value={`${result.latency.max}ms`} />
      </div>

      <div className="text-xs text-muted-foreground">
        Data sent {fmtBytes(result.dataSent)} · received {fmtBytes(result.dataReceived)}
      </div>

      {result.requests.length ? (
        <div>
          <h3 className="text-sm font-semibold mb-2">Per request</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">p95</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.requests.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-mono text-xs">{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.latency.p95 != null ? `${r.latency.p95}ms` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {result.thresholds.length ? (
        <div>
          <h3 className="text-sm font-semibold mb-2">Thresholds</h3>
          <ul className="space-y-1">
            {result.thresholds.map((t) => (
              <li key={t.name} className="flex items-center gap-2 text-sm">
                <span className={cn("font-mono text-xs", t.passed ? "text-emerald-600" : "text-destructive")}>
                  {t.passed ? "PASS" : "FAIL"}
                </span>
                <span className="text-muted-foreground">{t.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/loadtest/result-dashboard.dom.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/loadtest/status-pill.tsx src/components/loadtest/result-dashboard.tsx src/components/loadtest/result-dashboard.dom.test.tsx
git commit -m "feat(loadtest): result dashboard + status pill components"
```

---

## Task 5: Run progress component (`run-progress.tsx`)

**Files:**
- Create: `src/components/loadtest/run-progress.tsx`

- [ ] **Step 1: Create `src/components/loadtest/run-progress.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronDown, ChevronRight, X } from "lucide-react";

export function RunProgress({
  elapsedMs,
  vus,
  iterations,
  lines,
  onCancel,
}: {
  elapsedMs: number;
  vus?: number;
  iterations?: number;
  lines: string[];
  onCancel: () => void;
}) {
  const [showOutput, setShowOutput] = useState(false);
  const secs = (elapsedMs / 1000).toFixed(1);
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Loader2 className="size-4 animate-spin text-amber-500" />
          <div className="flex items-center gap-4 text-sm tabular-nums">
            <span><span className="text-muted-foreground">elapsed</span> {secs}s</span>
            <span><span className="text-muted-foreground">VUs</span> {vus ?? "—"}</span>
            <span><span className="text-muted-foreground">iterations</span> {iterations ?? 0}</span>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="size-3.5" />
          Cancel
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setShowOutput((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showOutput ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Show output
      </button>

      {showOutput ? (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-[11px] font-mono leading-relaxed">
          {lines.length ? lines.join("\n") : "waiting for k6 output…"}
        </pre>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/loadtest/run-progress.tsx
git commit -m "feat(loadtest): live run-progress panel with collapsible output"
```

---

## Task 6: Form serialization + form components

**Files:**
- Create: `src/app/loadtest/form-serialize.ts`
- Test: `src/app/loadtest/form-serialize.test.ts`
- Create: `src/app/loadtest/request-card.tsx`
- Create: `src/app/loadtest/auth-fields.tsx`
- Create: `src/app/loadtest/profile-fields.tsx`
- Create: `src/app/loadtest/loadtest-form.tsx`

- [ ] **Step 1: Write the failing serialization test**

```ts
// src/app/loadtest/form-serialize.test.ts
import { describe, it, expect } from "vitest";
import { emptyFormState, toFormState, buildSavedConfig, type HeaderRow } from "./form-serialize";

describe("form-serialize", () => {
  it("emptyFormState has one request and none auth", () => {
    const s = emptyFormState();
    expect(s.requests).toHaveLength(1);
    expect(s.auth.type).toBe("none");
  });

  it("buildSavedConfig converts header rows to a record and drops blanks", () => {
    const s = emptyFormState();
    s.target.baseUrl = "https://api.example.com";
    s.requests[0].name = "list";
    s.requests[0].path = "/items";
    s.requests[0].headers = [
      { key: "Accept", value: "application/json" },
      { key: "", value: "" },
    ] as HeaderRow[];
    const cfg = buildSavedConfig(s);
    expect(cfg.target.baseUrl).toBe("https://api.example.com");
    expect(cfg.requests[0].headers).toEqual({ Accept: "application/json" });
  });

  it("buildSavedConfig omits empty checks/body", () => {
    const s = emptyFormState();
    s.target.baseUrl = "https://x.test";
    s.requests[0].name = "a";
    s.requests[0].path = "/";
    const cfg = buildSavedConfig(s);
    expect(cfg.requests[0].body).toBeUndefined();
    expect(cfg.requests[0].checks).toBeUndefined();
  });

  it("round-trips a saved config through toFormState → buildSavedConfig", () => {
    const s = emptyFormState();
    s.target.baseUrl = "https://x.test";
    s.requests[0].name = "a";
    s.requests[0].path = "/a";
    s.auth = { type: "bearer", token: "tok" };
    s.profile = { type: "constant", vus: "3", duration: "10s" };
    const cfg = buildSavedConfig(s);
    const back = buildSavedConfig(toFormState({ name: "T", config: cfg } as never));
    expect(back.profile).toEqual({ type: "constant", vus: 3, duration: "10s" });
    expect(back.requests[0]).toMatchObject({ name: "a", path: "/a", method: "GET" });
  });

  it("blanks a secret in edit mode so the API preserves it", () => {
    // toFormState must NOT carry the masked secret into the editable field.
    const masked = { name: "T", config: { ...buildSavedConfig(emptyFormStateWith("https://x.test")), auth: { type: "bearer", token: "••••••••" } } };
    const fs = toFormState(masked as never);
    expect(fs.auth).toEqual({ type: "bearer", token: "" });
  });
});

function emptyFormStateWith(url: string) {
  const s = emptyFormState();
  s.target.baseUrl = url;
  s.requests[0].name = "a";
  s.requests[0].path = "/";
  return s;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/loadtest/form-serialize.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/app/loadtest/form-serialize.ts`**

```ts
import type { SavedAuth, SavedLoadTestConfig } from "@/lib/loadtest/store-schema";
import type { LoadProfile } from "@/lib/loadtest/schema";
import type { PublicLoadTest } from "@/lib/loadtest/store";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
export interface HeaderRow { key: string; value: string }

export interface RequestForm {
  name: string;
  method: HttpMethod;
  path: string;
  headers: HeaderRow[];
  body: string;
  checkStatus: string; // empty = none
  checkBodyContains: string; // empty = none
  thinkTime: string; // empty = none
}

// Form-state auth keeps literal values; profile uses string inputs for numbers.
export type AuthForm =
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apiKey"; header: string; value: string }
  | { type: "customHeaders"; headers: HeaderRow[] };

export type ProfileForm =
  | { type: "constant"; vus: string; duration: string }
  | { type: "ramping"; startVUs: string; stages: { target: string; duration: string }[] }
  | { type: "constantRate"; rate: string; duration: string; preAllocatedVUs: string }
  | { type: "rampingRate"; startRate: string; preAllocatedVUs: string; stages: { target: string; duration: string }[] }
  | { type: "baseline"; rate: string; duration: string; preAllocatedVUs: string }
  | { type: "breakpoint"; maxRate: string; duration: string; preAllocatedVUs: string };

export interface FormState {
  name: string;
  target: { baseUrl: string; headers: HeaderRow[] };
  requests: RequestForm[];
  auth: AuthForm;
  profile: ProfileForm;
  thresholds: { p95: string; p99: string; errorRate: string; minRps: string };
}

export function emptyRequest(): RequestForm {
  return { name: "", method: "GET", path: "/", headers: [], body: "", checkStatus: "", checkBodyContains: "", thinkTime: "" };
}

export function emptyFormState(): FormState {
  return {
    name: "",
    target: { baseUrl: "", headers: [] },
    requests: [emptyRequest()],
    auth: { type: "none" },
    profile: { type: "constant", vus: "5", duration: "30s" },
    thresholds: { p95: "", p99: "", errorRate: "", minRps: "" },
  };
}

function rowsToRecord(rows: HeaderRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const { key, value } of rows) if (key.trim()) out[key.trim()] = value;
  return Object.keys(out).length ? out : undefined;
}

function recordToRows(rec?: Record<string, string>): HeaderRow[] {
  return rec ? Object.entries(rec).map(([key, value]) => ({ key, value })) : [];
}

function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

export function buildSavedConfig(s: FormState): SavedLoadTestConfig {
  const requests = s.requests.map((r) => {
    const checks: { status?: number; bodyContains?: string } = {};
    const cs = numOrUndef(r.checkStatus);
    if (cs != null) checks.status = cs;
    if (r.checkBodyContains.trim()) checks.bodyContains = r.checkBodyContains;
    const tt = numOrUndef(r.thinkTime);
    return {
      name: r.name,
      method: r.method,
      path: r.path,
      headers: rowsToRecord(r.headers),
      body: r.body.trim() ? r.body : undefined,
      checks: Object.keys(checks).length ? checks : undefined,
      thinkTime: tt,
    };
  });

  let auth: SavedAuth;
  switch (s.auth.type) {
    case "bearer": auth = { type: "bearer", token: s.auth.token }; break;
    case "basic": auth = { type: "basic", username: s.auth.username, password: s.auth.password }; break;
    case "apiKey": auth = { type: "apiKey", header: s.auth.header, value: s.auth.value }; break;
    case "customHeaders": auth = { type: "customHeaders", headers: rowsToRecord(s.auth.headers) ?? {} }; break;
    case "none": auth = { type: "none" }; break;
  }

  const p = s.profile;
  let profile: LoadProfile;
  switch (p.type) {
    case "constant": profile = { type: "constant", vus: Number(p.vus), duration: p.duration }; break;
    case "ramping": profile = { type: "ramping", startVUs: Number(p.startVUs), stages: p.stages.map((x) => ({ target: Number(x.target), duration: x.duration })) }; break;
    case "constantRate": profile = { type: "constantRate", rate: Number(p.rate), duration: p.duration, preAllocatedVUs: Number(p.preAllocatedVUs) }; break;
    case "rampingRate": profile = { type: "rampingRate", startRate: Number(p.startRate), preAllocatedVUs: Number(p.preAllocatedVUs), stages: p.stages.map((x) => ({ target: Number(x.target), duration: x.duration })) }; break;
    case "baseline": profile = { type: "baseline", rate: Number(p.rate), duration: p.duration, preAllocatedVUs: Number(p.preAllocatedVUs) }; break;
    case "breakpoint": profile = { type: "breakpoint", maxRate: Number(p.maxRate), duration: p.duration, preAllocatedVUs: Number(p.preAllocatedVUs) }; break;
  }

  const thresholds: { p95?: number; p99?: number; errorRate?: number; minRps?: number } = {};
  const p95 = numOrUndef(s.thresholds.p95); if (p95 != null) thresholds.p95 = p95;
  const p99 = numOrUndef(s.thresholds.p99); if (p99 != null) thresholds.p99 = p99;
  const er = numOrUndef(s.thresholds.errorRate); if (er != null) thresholds.errorRate = er;
  const rps = numOrUndef(s.thresholds.minRps); if (rps != null) thresholds.minRps = rps;

  return {
    target: { baseUrl: s.target.baseUrl, headers: rowsToRecord(s.target.headers) },
    requests,
    auth,
    profile,
    thresholds: Object.keys(thresholds).length ? thresholds : undefined,
  };
}

export function toFormState(initial: PublicLoadTest): FormState {
  const c = initial.config;
  // Secrets arrive masked from the API; clear them so edit mode submits blank
  // (the server's mergeAuth preserves the stored value on blank).
  let auth: AuthForm;
  switch (c.auth.type) {
    case "bearer": auth = { type: "bearer", token: "" }; break;
    case "basic": auth = { type: "basic", username: c.auth.username, password: "" }; break;
    case "apiKey": auth = { type: "apiKey", header: c.auth.header, value: "" }; break;
    case "customHeaders": auth = { type: "customHeaders", headers: Object.keys(c.auth.headers).map((key) => ({ key, value: "" })) }; break;
    case "none": auth = { type: "none" }; break;
  }

  const p = c.profile;
  let profile: ProfileForm;
  switch (p.type) {
    case "constant": profile = { type: "constant", vus: String(p.vus), duration: p.duration }; break;
    case "ramping": profile = { type: "ramping", startVUs: String(p.startVUs), stages: p.stages.map((x) => ({ target: String(x.target), duration: x.duration })) }; break;
    case "constantRate": profile = { type: "constantRate", rate: String(p.rate), duration: p.duration, preAllocatedVUs: String(p.preAllocatedVUs) }; break;
    case "rampingRate": profile = { type: "rampingRate", startRate: String(p.startRate), preAllocatedVUs: String(p.preAllocatedVUs), stages: p.stages.map((x) => ({ target: String(x.target), duration: x.duration })) }; break;
    case "baseline": profile = { type: "baseline", rate: String(p.rate), duration: p.duration, preAllocatedVUs: String(p.preAllocatedVUs) }; break;
    case "breakpoint": profile = { type: "breakpoint", maxRate: String(p.maxRate), duration: p.duration, preAllocatedVUs: String(p.preAllocatedVUs) }; break;
  }

  return {
    name: initial.name,
    target: { baseUrl: c.target.baseUrl, headers: recordToRows(c.target.headers) },
    requests: c.requests.map((r) => ({
      name: r.name,
      method: r.method,
      path: r.path,
      headers: recordToRows(r.headers),
      body: r.body ?? "",
      checkStatus: r.checks?.status != null ? String(r.checks.status) : "",
      checkBodyContains: r.checks?.bodyContains ?? "",
      thinkTime: r.thinkTime != null ? String(r.thinkTime) : "",
    })),
    auth,
    profile,
    thresholds: {
      p95: c.thresholds?.p95 != null ? String(c.thresholds.p95) : "",
      p99: c.thresholds?.p99 != null ? String(c.thresholds.p99) : "",
      errorRate: c.thresholds?.errorRate != null ? String(c.thresholds.errorRate) : "",
      minRps: c.thresholds?.minRps != null ? String(c.thresholds.minRps) : "",
    },
  };
}
```

- [ ] **Step 4: Run the serialization test to verify it passes**

Run: `npx vitest run src/app/loadtest/form-serialize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit the helper**

```bash
git add src/app/loadtest/form-serialize.ts src/app/loadtest/form-serialize.test.ts
git commit -m "feat(loadtest): form-state <-> SavedLoadTestConfig serialization"
```

- [ ] **Step 6: Create `src/app/loadtest/request-card.tsx`**

```tsx
"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import type { HeaderRow, HttpMethod, RequestForm } from "./form-serialize";
import { HeaderRows } from "./auth-fields";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function RequestCard({
  req,
  index,
  expanded,
  onToggle,
  onChange,
  onRemove,
  onMove,
  canRemove,
}: {
  req: RequestForm;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<RequestForm>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canRemove: boolean;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggle} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <span className="font-mono text-xs font-medium">{req.method}</span>
        <span className="font-mono text-xs text-muted-foreground truncate flex-1">{req.path || "/"}</span>
        <span className="text-xs text-muted-foreground truncate">{req.name || `request ${index + 1}`}</span>
        <Button type="button" size="icon" variant="ghost" onClick={() => onMove(-1)} aria-label="Move up">
          <ArrowUp className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={() => onMove(1)} aria-label="Move down">
          <ArrowDown className="size-3.5" />
        </Button>
        <Button type="button" size="icon" variant="ghost" onClick={onRemove} disabled={!canRemove} aria-label="Remove">
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={req.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="list items" />
            </div>
            <div className="space-y-1">
              <Label>Method</Label>
              <Select value={req.method} onValueChange={(v) => onChange({ method: v as HttpMethod })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Path</Label>
            <Input value={req.path} onChange={(e) => onChange({ path: e.target.value })} placeholder="/api/items" />
          </div>
          <div className="space-y-1">
            <Label>Headers</Label>
            <HeaderRows rows={req.headers} onChange={(headers: HeaderRow[]) => onChange({ headers })} />
          </div>
          <div className="space-y-1">
            <Label>Body</Label>
            <Textarea value={req.body} onChange={(e) => onChange({ body: e.target.value })} rows={3} placeholder='{"key":"value"}' />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Check status</Label>
              <Input value={req.checkStatus} onChange={(e) => onChange({ checkStatus: e.target.value })} placeholder="200" />
            </div>
            <div className="space-y-1">
              <Label>Body contains</Label>
              <Input value={req.checkBodyContains} onChange={(e) => onChange({ checkBodyContains: e.target.value })} placeholder="ok" />
            </div>
            <div className="space-y-1">
              <Label>Think time (s)</Label>
              <Input value={req.thinkTime} onChange={(e) => onChange({ thinkTime: e.target.value })} placeholder="0" />
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 7: Create `src/app/loadtest/auth-fields.tsx`** (includes the shared `HeaderRows` editor)

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { AuthForm, HeaderRow } from "./form-serialize";

export function HeaderRows({
  rows,
  onChange,
  secret = false,
}: {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  secret?: boolean;
}) {
  const set = (i: number, patch: Partial<HeaderRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <Input value={r.key} onChange={(e) => set(i, { key: e.target.value })} placeholder="Header" className="flex-1" />
          <Input
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder={secret ? "(unchanged — leave blank to keep)" : "value"}
            type={secret ? "password" : "text"}
            className="flex-1"
          />
          <Button type="button" size="icon" variant="ghost" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} aria-label="Remove header">
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...rows, { key: "", value: "" }])}>
        <Plus className="size-3.5" />
        Add header
      </Button>
    </div>
  );
}

const AUTH_TYPES = ["none", "bearer", "basic", "apiKey", "customHeaders"] as const;

export function AuthFields({
  auth,
  editing,
  onChange,
}: {
  auth: AuthForm;
  editing: boolean;
  onChange: (auth: AuthForm) => void;
}) {
  const placeholder = editing ? "(unchanged — leave blank to keep)" : undefined;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Auth</Label>
        <Select
          value={auth.type}
          onValueChange={(v) => {
            const t = v as AuthForm["type"];
            if (t === "none") onChange({ type: "none" });
            else if (t === "bearer") onChange({ type: "bearer", token: "" });
            else if (t === "basic") onChange({ type: "basic", username: "", password: "" });
            else if (t === "apiKey") onChange({ type: "apiKey", header: "", value: "" });
            else onChange({ type: "customHeaders", headers: [] });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {AUTH_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {auth.type === "bearer" ? (
        <div className="space-y-1">
          <Label>Token</Label>
          <Input type="password" value={auth.token} placeholder={placeholder} onChange={(e) => onChange({ ...auth, token: e.target.value })} />
        </div>
      ) : null}

      {auth.type === "basic" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Username</Label>
            <Input value={auth.username} onChange={(e) => onChange({ ...auth, username: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Password</Label>
            <Input type="password" value={auth.password} placeholder={placeholder} onChange={(e) => onChange({ ...auth, password: e.target.value })} />
          </div>
        </div>
      ) : null}

      {auth.type === "apiKey" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Header</Label>
            <Input value={auth.header} onChange={(e) => onChange({ ...auth, header: e.target.value })} placeholder="X-Api-Key" />
          </div>
          <div className="space-y-1">
            <Label>Value</Label>
            <Input type="password" value={auth.value} placeholder={placeholder} onChange={(e) => onChange({ ...auth, value: e.target.value })} />
          </div>
        </div>
      ) : null}

      {auth.type === "customHeaders" ? (
        <div className="space-y-1">
          <Label>Custom auth headers</Label>
          <HeaderRows rows={auth.headers} secret={editing} onChange={(headers) => onChange({ ...auth, headers })} />
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 8: Create `src/app/loadtest/profile-fields.tsx`**

```tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProfileForm } from "./form-serialize";

const PROFILE_TYPES = ["constant", "ramping", "constantRate", "rampingRate", "baseline", "breakpoint"] as const;

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function ProfileFields({ profile, onChange }: { profile: ProfileForm; onChange: (p: ProfileForm) => void }) {
  const set = (patch: object) => onChange({ ...profile, ...patch } as ProfileForm);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>Load profile</Label>
        <Select
          value={profile.type}
          onValueChange={(v) => {
            const t = v as ProfileForm["type"];
            if (t === "constant") onChange({ type: "constant", vus: "5", duration: "30s" });
            else if (t === "ramping") onChange({ type: "ramping", startVUs: "0", stages: [{ target: "20", duration: "30s" }] });
            else if (t === "constantRate") onChange({ type: "constantRate", rate: "50", duration: "1m", preAllocatedVUs: "50" });
            else if (t === "rampingRate") onChange({ type: "rampingRate", startRate: "0", preAllocatedVUs: "100", stages: [{ target: "200", duration: "2m" }] });
            else if (t === "baseline") onChange({ type: "baseline", rate: "50", duration: "1m", preAllocatedVUs: "50" });
            else onChange({ type: "breakpoint", maxRate: "500", duration: "2m", preAllocatedVUs: "200" });
          }}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROFILE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {profile.type === "constant" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="VUs" value={profile.vus} onChange={(v) => set({ vus: v })} />
          <Field label="Duration" value={profile.duration} onChange={(v) => set({ duration: v })} placeholder="30s" />
        </div>
      ) : null}

      {profile.type === "baseline" ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Rate (rps)" value={profile.rate} onChange={(v) => set({ rate: v })} />
          <Field label="Duration" value={profile.duration} onChange={(v) => set({ duration: v })} />
          <Field label="Pre-alloc VUs" value={profile.preAllocatedVUs} onChange={(v) => set({ preAllocatedVUs: v })} />
        </div>
      ) : null}

      {profile.type === "breakpoint" ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Max rate (rps)" value={profile.maxRate} onChange={(v) => set({ maxRate: v })} />
          <Field label="Duration" value={profile.duration} onChange={(v) => set({ duration: v })} />
          <Field label="Pre-alloc VUs" value={profile.preAllocatedVUs} onChange={(v) => set({ preAllocatedVUs: v })} />
        </div>
      ) : null}

      {profile.type === "constantRate" ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Rate (rps)" value={profile.rate} onChange={(v) => set({ rate: v })} />
          <Field label="Duration" value={profile.duration} onChange={(v) => set({ duration: v })} />
          <Field label="Pre-alloc VUs" value={profile.preAllocatedVUs} onChange={(v) => set({ preAllocatedVUs: v })} />
        </div>
      ) : null}

      {profile.type === "ramping" ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start VUs" value={profile.startVUs} onChange={(v) => set({ startVUs: v })} />
          <Field label="Stage target / duration" value={profile.stages[0]?.target ?? ""} onChange={(v) => set({ stages: [{ target: v, duration: profile.stages[0]?.duration ?? "30s" }] })} placeholder="20" />
        </div>
      ) : null}

      {profile.type === "rampingRate" ? (
        <div className="grid grid-cols-3 gap-3">
          <Field label="Start rate" value={profile.startRate} onChange={(v) => set({ startRate: v })} />
          <Field label="Pre-alloc VUs" value={profile.preAllocatedVUs} onChange={(v) => set({ preAllocatedVUs: v })} />
          <Field label="Stage target" value={profile.stages[0]?.target ?? ""} onChange={(v) => set({ stages: [{ target: v, duration: profile.stages[0]?.duration ?? "2m" }] })} />
        </div>
      ) : null}
    </div>
  );
}
```

> Note: `ramping`/`rampingRate` expose a single stage in this v1 form (the most common case); the data model holds an array, so multi-stage is a future enhancement without migration.

- [ ] **Step 9: Create `src/app/loadtest/loadtest-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, Plus, Save } from "lucide-react";
import type { PublicLoadTest } from "@/lib/loadtest/store";
import {
  buildSavedConfig,
  emptyFormState,
  emptyRequest,
  toFormState,
  type FormState,
  type RequestForm,
} from "./form-serialize";
import { HeaderRows, AuthFields } from "./auth-fields";
import { ProfileFields } from "./profile-fields";
import { RequestCard } from "./request-card";

export function LoadTestForm({ initial, onSaved }: { initial?: PublicLoadTest; onSaved?: () => void }) {
  const editing = Boolean(initial);
  const router = useRouter();
  const [state, setState] = useState<FormState>(() => (initial ? toFormState(initial) : emptyFormState()));
  const [expanded, setExpanded] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchRequest = (i: number, patch: Partial<RequestForm>) =>
    setState((s) => ({ ...s, requests: s.requests.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  const moveRequest = (i: number, dir: -1 | 1) =>
    setState((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.requests.length) return s;
      const next = [...s.requests];
      [next[i], next[j]] = [next[j], next[i]];
      return { ...s, requests: next };
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const config = buildSavedConfig(state);
      const res = editing
        ? await fetch(`/api/loadtest/${initial!.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: state.name, config }),
          })
        : await fetch("/api/loadtest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: state.name, config }),
          });
      const data = await res.json();
      if (res.ok) {
        toast.success(editing ? "Test updated" : "Test created");
        onSaved?.();
        if (!editing && data.loadtest?.id) router.push(`/loadtest/${data.loadtest.id}/run`);
      } else {
        setError(data.error || "Save failed");
        toast.error("Save failed", { description: typeof data.error === "string" ? data.error : undefined });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="p-5 space-y-4">
        <div className="space-y-1">
          <Label>Test name</Label>
          <Input value={state.name} onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))} placeholder="Checkout flow" />
        </div>
        <div className="space-y-1">
          <Label>Base URL</Label>
          <Input value={state.target.baseUrl} onChange={(e) => setState((s) => ({ ...s, target: { ...s.target, baseUrl: e.target.value } }))} placeholder="https://api.example.com" />
        </div>
        <div className="space-y-1">
          <Label>Default headers</Label>
          <HeaderRows rows={state.target.headers} onChange={(headers) => setState((s) => ({ ...s, target: { ...s.target, headers } }))} />
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Requests</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setState((s) => ({ ...s, requests: [...s.requests, emptyRequest()] }))}>
            <Plus className="size-3.5" />
            Add request
          </Button>
        </div>
        <div className="space-y-2">
          {state.requests.map((req, i) => (
            <RequestCard
              key={i}
              req={req}
              index={i}
              expanded={expanded === i}
              onToggle={() => setExpanded((cur) => (cur === i ? -1 : i))}
              onChange={(patch) => patchRequest(i, patch)}
              onRemove={() => setState((s) => ({ ...s, requests: s.requests.filter((_, idx) => idx !== i) }))}
              onMove={(dir) => moveRequest(i, dir)}
              canRemove={state.requests.length > 1}
            />
          ))}
        </div>
      </Card>

      <Card className="p-5"><AuthFields auth={state.auth} editing={editing} onChange={(auth) => setState((s) => ({ ...s, auth }))} /></Card>

      <Card className="p-5"><ProfileFields profile={state.profile} onChange={(profile) => setState((s) => ({ ...s, profile }))} /></Card>

      <Card className="p-5 space-y-3">
        <h3 className="font-semibold text-sm">Thresholds (optional)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1"><Label>p95 (ms)</Label><Input value={state.thresholds.p95} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, p95: e.target.value } }))} /></div>
          <div className="space-y-1"><Label>p99 (ms)</Label><Input value={state.thresholds.p99} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, p99: e.target.value } }))} /></div>
          <div className="space-y-1"><Label>Error rate (0–1)</Label><Input value={state.thresholds.errorRate} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, errorRate: e.target.value } }))} placeholder="0.01" /></div>
          <div className="space-y-1"><Label>Min RPS</Label><Input value={state.thresholds.minRps} onChange={(e) => setState((s) => ({ ...s, thresholds: { ...s.thresholds, minRps: e.target.value } }))} /></div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {editing ? "Save changes" : "Create test"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 10: Verify typecheck + lint, run the form-serialize test once more**

Run: `npm run typecheck && npm run lint && npx vitest run src/app/loadtest/form-serialize.test.ts`
Expected: clean + 5 tests pass.

- [ ] **Step 11: Commit the form**

```bash
git add src/app/loadtest/request-card.tsx src/app/loadtest/auth-fields.tsx src/app/loadtest/profile-fields.tsx src/app/loadtest/loadtest-form.tsx
git commit -m "feat(loadtest): create/edit test form (multi-request, auth, profile, thresholds)"
```

---

## Task 7: Saved-tests sheet + list + tech-grid branch

**Files:**
- Create: `src/components/loadtest-list.tsx`
- Create: `src/components/loadtest-sheet.tsx`
- Modify: `src/components/tech-grid.tsx` (the Task-3 Step-6 edits)

- [ ] **Step 1: Create `src/components/loadtest-list.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StatusPill } from "@/components/loadtest/status-pill";
import type { PublicLoadTest } from "@/lib/loadtest/store";

export function LoadTestList({ refreshKey, onEdit }: { refreshKey: number; onEdit: (t: PublicLoadTest) => void }) {
  const [tests, setTests] = useState<PublicLoadTest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/loadtest", { cache: "no-store" });
        const data = (await res.json()) as { loadtests: PublicLoadTest[] };
        if (active) setTests(data.loadtests ?? []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshKey]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/loadtest/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTests((t) => t.filter((x) => x.id !== id));
      toast.success("Test deleted");
    } else {
      toast.error("Delete failed");
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!tests.length) return <p className="text-sm text-muted-foreground">No saved tests yet — click <span className="font-medium text-foreground">New test</span> to add one.</p>;

  return (
    <div className="space-y-2">
      {tests.map((t) => (
        <Card key={t.id} className="p-3 flex items-center gap-3">
          <Link href={`/loadtest/${t.id}/run`} className="min-w-0 flex-1">
            <div className="font-medium text-sm truncate">{t.name}</div>
            <div className="text-xs text-muted-foreground truncate">{t.config.target.baseUrl}</div>
          </Link>
          {t.lastRun ? <StatusPill status={t.lastRun.status} /> : <span className="text-xs text-muted-foreground">no runs</span>}
          <Button size="sm" variant="ghost" onClick={() => onEdit(t)}>Edit</Button>
          <Button size="icon" variant="ghost" onClick={() => remove(t.id)} aria-label="Delete test"><Trash2 className="size-3.5" /></Button>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/components/loadtest-sheet.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LoadTestList } from "@/components/loadtest-list";
import { LoadTestForm } from "@/app/loadtest/loadtest-form";
import type { PublicLoadTest } from "@/lib/loadtest/store";

export function LoadTestSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<PublicLoadTest | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (open) { setView("list"); setEditing(null); }
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="p-5 pb-4 border-b border-border/60">
          <SheetTitle className="text-base">Load Testing</SheetTitle>
          <SheetDescription className="text-xs">Define and run k6 load tests against any REST API.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {view === "list" ? (
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">Saved tests</h3>
                <Button size="sm" onClick={() => { setEditing(null); setView("form"); }}>
                  <Plus className="size-3.5" />
                  New test
                </Button>
              </div>
              <LoadTestList refreshKey={refresh} onEdit={(t) => { setEditing(t); setView("form"); }} />
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <Button size="sm" variant="ghost" className="-ml-2" onClick={() => { setView("list"); setEditing(null); }}>
                <ArrowLeft className="size-3.5" />
                Back to tests
              </Button>
              <LoadTestForm
                initial={editing ?? undefined}
                onSaved={() => { setRefresh((n) => n + 1); setEditing(null); setView("list"); }}
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: Apply the `tech-grid.tsx` edits from Task 3 Step 6**

Make exactly the edits described in Task 3 Step 6 (import `LoadTestSheet`, add `loadtestOpen` state, fetch the loadtest count in the effect, branch the tile `onClick`, render `<LoadTestSheet .../>`).

- [ ] **Step 4: Verify typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean; build succeeds (the `loadtest` import chain now resolves).

- [ ] **Step 5: Commit**

```bash
git add src/components/loadtest-list.tsx src/components/loadtest-sheet.tsx src/components/tech-grid.tsx
git commit -m "feat(loadtest): saved-tests sheet + list, home-tile branch"
```

---

## Task 8: Workspace layout + Config page

**Files:**
- Create: `src/app/loadtest/[testId]/layout.tsx`
- Create: `src/app/loadtest/[testId]/page.tsx`
- Create: `src/app/loadtest/[testId]/config/page.tsx`
- Create: `src/app/loadtest/[testId]/config/config-client.tsx`

- [ ] **Step 1: Create `src/app/loadtest/[testId]/layout.tsx`**

```tsx
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { SidebarLink, SidebarSection } from "@/components/workspace/sidebar-link";
import { getTech } from "@/lib/tech-catalog";
import { requireLoadTest } from "@/lib/loadtest/server";
import { Settings, Play, History } from "lucide-react";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ testId: string }>;
  children: React.ReactNode;
}

export default async function LoadTestWorkspaceLayout({ params, children }: LayoutProps) {
  const { testId } = await params;
  const test = requireLoadTest(testId);
  const tech = getTech("loadtest")!;
  return (
    <WorkspaceShell
      tech={tech}
      connectionName={test.name}
      connectionId={testId}
      subtitle={test.config.target.baseUrl}
      sidebar={
        <SidebarSection>
          <SidebarLink href={`/loadtest/${testId}/config`} icon={<Settings className="size-4" />}>Config</SidebarLink>
          <SidebarLink href={`/loadtest/${testId}/run`} icon={<Play className="size-4" />}>Run</SidebarLink>
          <SidebarLink href={`/loadtest/${testId}/history`} icon={<History className="size-4" />}>History</SidebarLink>
        </SidebarSection>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
```

- [ ] **Step 2: Create `src/app/loadtest/[testId]/page.tsx`**

```tsx
import { redirect } from "next/navigation";

export default async function LoadTestIndex({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  redirect(`/loadtest/${testId}/run`);
}
```

- [ ] **Step 3: Create `src/app/loadtest/[testId]/config/page.tsx`**

```tsx
import { ConfigClient } from "./config-client";

export default async function ConfigPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  return <ConfigClient testId={testId} />;
}
```

- [ ] **Step 4: Create `src/app/loadtest/[testId]/config/config-client.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { LoadTestForm } from "@/app/loadtest/loadtest-form";
import type { PublicLoadTest } from "@/lib/loadtest/store";

export function ConfigClient({ testId }: { testId: string }) {
  const [test, setTest] = useState<PublicLoadTest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/loadtest/${testId}`, { cache: "no-store" });
        const data = await res.json();
        if (!active) return;
        if (res.ok) setTest(data.loadtest as PublicLoadTest);
        else setError(data.error || "Failed to load test");
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { active = false; };
  }, [testId]);

  return (
    <WorkspacePage title="Configuration" description="Edit this load test's target, requests, auth, profile and thresholds.">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {test ? <LoadTestForm initial={test} /> : !error ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
    </WorkspacePage>
  );
}
```

> Confirm the import path of `WorkspacePage` (search `workspace-page`): it's `@/components/workspace/workspace-page`. Adjust if the repo path differs.

- [ ] **Step 5: Verify typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean; `/loadtest/[testId]/config` appears in the route list.

- [ ] **Step 6: Commit**

```bash
git add src/app/loadtest/[testId]/layout.tsx src/app/loadtest/[testId]/page.tsx src/app/loadtest/[testId]/config/page.tsx src/app/loadtest/[testId]/config/config-client.tsx
git commit -m "feat(loadtest): workspace layout + Config page"
```

---

## Task 9: SSE parser + Run page

**Files:**
- Create: `src/app/loadtest/[testId]/run/sse.ts`
- Test: `src/app/loadtest/[testId]/run/sse.test.ts`
- Create: `src/app/loadtest/[testId]/run/page.tsx`
- Create: `src/app/loadtest/[testId]/run/run-client.tsx`

- [ ] **Step 1: Write the failing SSE-parser test**

```ts
// src/app/loadtest/[testId]/run/sse.test.ts
import { describe, it, expect } from "vitest";
import { SseFrameParser } from "./sse";

describe("SseFrameParser", () => {
  it("parses complete frames split across chunks", () => {
    const p = new SseFrameParser();
    const a = p.push("event: progress\ndata: {\"line\":\"hi\"}\n\n");
    expect(a).toEqual([{ event: "progress", data: { line: "hi" } }]);
    const b = p.push("event: done\ndata: {\"runId\":\"r1\",\"st");
    expect(b).toEqual([]); // incomplete
    const c = p.push("atus\":\"passed\"}\n\n");
    expect(c).toEqual([{ event: "done", data: { runId: "r1", status: "passed" } }]);
  });

  it("ignores heartbeat comment lines", () => {
    const p = new SseFrameParser();
    expect(p.push(": ping\n\n")).toEqual([]);
  });

  it("parses two frames in one chunk", () => {
    const p = new SseFrameParser();
    const out = p.push('event: progress\ndata: {"line":"a"}\n\nevent: progress\ndata: {"line":"b"}\n\n');
    expect(out).toEqual([
      { event: "progress", data: { line: "a" } },
      { event: "progress", data: { line: "b" } },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/loadtest/[testId]/run/sse.test.ts"`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Create `src/app/loadtest/[testId]/run/sse.ts`**

```ts
export interface SseFrame {
  event: string;
  data: unknown;
}

/** Incrementally parses an SSE byte stream's text into {event,data} frames. */
export class SseFrameParser {
  private buf = "";

  push(chunk: string): SseFrame[] {
    this.buf += chunk;
    const frames: SseFrame[] = [];
    let sep: number;
    while ((sep = this.buf.indexOf("\n\n")) !== -1) {
      const raw = this.buf.slice(0, sep);
      this.buf = this.buf.slice(sep + 2);
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue; // heartbeat / comment
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue; // comment-only block
      let data: unknown = dataLines.join("\n");
      try {
        data = JSON.parse(data as string);
      } catch {
        /* leave as string */
      }
      frames.push({ event, data });
    }
    return frames;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/loadtest/[testId]/run/sse.test.ts"`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `src/app/loadtest/[testId]/run/page.tsx`**

```tsx
import { RunClient } from "./run-client";

export default async function RunPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  return <RunClient testId={testId} />;
}
```

- [ ] **Step 6: Create `src/app/loadtest/[testId]/run/run-client.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Play } from "lucide-react";
import { ResultDashboard } from "@/components/loadtest/result-dashboard";
import { RunProgress } from "@/components/loadtest/run-progress";
import { parseK6Progress } from "@/lib/loadtest/progress-parser";
import type { LoadTestResult } from "@/lib/loadtest/results";
import type { PublicLoadTest, LoadTestRun } from "@/lib/loadtest/store";
import { SseFrameParser } from "./sse";

export function RunClient({ testId }: { testId: string }) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [vus, setVus] = useState<number | undefined>();
  const [iterations, setIterations] = useState<number | undefined>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<LoadTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef(0);

  // Load the latest run's result when idle.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const tRes = await fetch(`/api/loadtest/${testId}`, { cache: "no-store" });
        const tData = await tRes.json();
        const last = (tData.loadtest as PublicLoadTest | undefined)?.lastRun;
        if (!last) return;
        const rRes = await fetch(`/api/loadtest/${testId}/runs/${last.id}`, { cache: "no-store" });
        const rData = await rRes.json();
        if (active && rRes.ok) setResult((rData.run as LoadTestRun).result ?? null);
      } catch {
        /* ignore */
      }
    })();
    return () => { active = false; };
  }, [testId]);

  // elapsed timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    setRunning(true);
    setLines([]);
    setVus(undefined);
    setIterations(undefined);
    setResult(null);
    setError(null);
    startRef.current = Date.now();
    setElapsedMs(0);
    const ac = new AbortController();
    abortRef.current = ac;
    const parser = new SseFrameParser();
    try {
      const res = await fetch(`/api/loadtest/${testId}/run`, { method: "POST", signal: ac.signal });
      if (!res.body) throw new Error("no response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          if (frame.event === "progress") {
            const line = (frame.data as { line: string }).line;
            setLines((l) => [...l, line]);
            const parsed = parseK6Progress(line);
            if (parsed.vus != null) setVus(parsed.vus);
            if (parsed.iterations != null) setIterations(parsed.iterations);
          } else if (frame.event === "result") {
            setResult(frame.data as LoadTestResult);
          } else if (frame.event === "error") {
            setError((frame.data as { message: string }).message);
          }
        }
      }
    } catch (e) {
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  return (
    <WorkspacePage
      title="Run"
      description="Execute this load test and watch live progress."
      actions={!running ? <Button onClick={run}><Play className="size-4" />Run test</Button> : null}
    >
      <div className="space-y-5">
        {running ? <RunProgress elapsedMs={elapsedMs} vus={vus} iterations={iterations} lines={lines} onCancel={cancel} /> : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Run failed</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        ) : null}
        {result ? <ResultDashboard result={result} /> : !running && !error ? (
          <p className="text-sm text-muted-foreground">No results yet — click <span className="font-medium text-foreground">Run test</span>.</p>
        ) : null}
      </div>
    </WorkspacePage>
  );
}
```

- [ ] **Step 7: Verify typecheck + lint + the SSE test**

Run: `npm run typecheck && npm run lint && npx vitest run "src/app/loadtest/[testId]/run/sse.test.ts"`
Expected: clean + 3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add "src/app/loadtest/[testId]/run/sse.ts" "src/app/loadtest/[testId]/run/sse.test.ts" "src/app/loadtest/[testId]/run/page.tsx" "src/app/loadtest/[testId]/run/run-client.tsx"
git commit -m "feat(loadtest): Run page with live SSE streaming + results"
```

---

## Task 10: History page

**Files:**
- Create: `src/app/loadtest/[testId]/history/page.tsx`
- Create: `src/app/loadtest/[testId]/history/history-client.tsx`

- [ ] **Step 1: Create `src/app/loadtest/[testId]/history/page.tsx`**

```tsx
import { HistoryClient } from "./history-client";

export default async function HistoryPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  return <HistoryClient testId={testId} />;
}
```

- [ ] **Step 2: Create `src/app/loadtest/[testId]/history/history-client.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/workspace/sparkline";
import { RelativeTime } from "@/components/workspace/relative-time";
import { StatusPill } from "@/components/loadtest/status-pill";
import { ResultDashboard } from "@/components/loadtest/result-dashboard";
import type { RunSummary, LoadTestRun } from "@/lib/loadtest/store";

export function HistoryClient({ testId }: { testId: string }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LoadTestRun | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/loadtest/${testId}/runs`, { cache: "no-store" });
        const data = await res.json();
        if (active) setRuns((data.runs as RunSummary[]) ?? []);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [testId]);

  const openRun = async (runId: string) => {
    const res = await fetch(`/api/loadtest/${testId}/runs/${runId}`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setSelected(data.run as LoadTestRun);
  };

  // p95 trend, oldest→newest (runs come newest-first)
  const trend = [...runs].reverse().map((r) => r.p95 ?? 0).filter((n) => n > 0);

  return (
    <WorkspacePage title="History" description="Past runs of this load test.">
      <div className="space-y-5">
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {!loading && !runs.length ? <p className="text-sm text-muted-foreground">No runs yet.</p> : null}

        {trend.length >= 2 ? (
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">p95 trend</div>
            <Sparkline data={trend} className="h-10 w-full text-brand" />
          </Card>
        ) : null}

        <div className="space-y-2">
          {runs.map((r) => (
            <button key={r.id} type="button" onClick={() => openRun(r.id)} className="w-full text-left">
              <Card className="p-3 flex items-center gap-3 hover:border-border/80">
                <StatusPill status={r.status} />
                <span className="text-xs text-muted-foreground"><RelativeTime value={r.startedAt} /></span>
                <div className="flex-1" />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {r.p95 != null ? `p95 ${r.p95}ms` : "—"} · {r.rps != null ? `${r.rps.toFixed(1)} rps` : "—"} · {r.errorRate != null ? `${(r.errorRate * 100).toFixed(1)}%` : "—"}
                </span>
              </Card>
            </button>
          ))}
        </div>

        {selected?.result ? (
          <div>
            <h3 className="text-sm font-semibold mb-2">Run detail</h3>
            <ResultDashboard result={selected.result} />
          </div>
        ) : null}
      </div>
    </WorkspacePage>
  );
}
```

> Confirm import paths during implementation: `Sparkline` (`grep -rl "export function Sparkline"`), `RelativeTime` (`@/components/workspace/relative-time`), `WorkspacePage`. `RelativeTime`'s prop may be named `value` or `date` — check `src/components/workspace/relative-time.tsx` and match it; if it takes a `Date`, pass `new Date(r.startedAt)`.

- [ ] **Step 3: Verify typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: clean; `/loadtest/[testId]/history` in the route list.

- [ ] **Step 4: Commit**

```bash
git add "src/app/loadtest/[testId]/history/page.tsx" "src/app/loadtest/[testId]/history/history-client.tsx"
git commit -m "feat(loadtest): History page with p95 trend + run detail"
```

---

## Task 11: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit + client suite**

Run: `npm run test`
Expected: PASS (existing + new progress-parser, tech-catalog, form-serialize, sse, result-dashboard tests).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/loadtest/[testId]/{config,run,history}` and the page routes appear.

- [ ] **Step 4: (Docker available) Manual UI smoke**

`npm run dev`, open `http://localhost:3000`:
- Confirm a "Load Testing" tile under the "Testing" category; click it → sheet opens.
- "New test" → fill base URL `https://httpbin.org`, one request `GET /get` check status 200, profile baseline → Create.
- On the Run page → "Run test" → live panel shows elapsed/VUs/iterations, "Show output" reveals k6 lines; on completion the results dashboard renders.
- History page lists the run; clicking it shows the result; p95 trend appears after ≥2 runs.
- Edit the test (Config), change a threshold, save; re-run.

- [ ] **Step 5: Finish**

All Plan-B tasks complete. Use `superpowers:finishing-a-development-branch` to merge/PR.

---

## Self-Review Notes (Plan B)

- **Spec coverage:** engine `--quiet` fix → T1; progress parser → T2; catalog "Testing" + tile + icon → T3; tech-grid branch → T3/T7; result dashboard + status pill → T4; run-progress panel → T5; form (multi-request/auth/profile/thresholds) + serialization → T6; saved-tests sheet/list → T7; workspace layout + Config → T8; Run + SSE streaming → T9; History + p95 trend → T10; verification → T11.
- **Type consistency:** `FormState`/`AuthForm`/`ProfileForm`/`RequestForm`/`HeaderRow` defined in T6 `form-serialize.ts` and consumed by T6 components; `PublicLoadTest`/`RunSummary`/`LoadTestRun`/`RunStatus` (from store) and `LoadTestResult` (from results) imported as types across T4/T7/T9/T10; `SseFrame`/`SseFrameParser` defined in T9 and used by run-client; `parseK6Progress` (T2) used in run-client (T9); `StatusPill`/`ResultDashboard`/`RunProgress` (T4/T5) used in T7/T9/T10.
- **Ordering:** T3 commits only catalog+icon; the `tech-grid` edit (which imports `LoadTestSheet`) is deferred to T7 so the branch never has an unresolved import. The form (T6) is imported by the sheet (T7) and config (T8) — built first.
- **Deferred (per spec):** live error-rate/percentile streaming, multi-stage ramping in the form (single stage in v1; data model supports arrays), run comparison/diff, scheduled runs, export.
- **Verify-at-implementation import paths:** `WorkspacePage`, `Sparkline`, `RelativeTime` (prop name), `Textarea`/`Select`/`Table` exports — all flagged inline.
