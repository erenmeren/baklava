# Load Testing Workspace — Plan A: Backend + API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side foundation for the Load Testing workspace — a persisted store for saved tests + run history, a UI-auth→engine translator, a run controller, and the full HTTP API — all over the existing `src/lib/loadtest` engine, with no engine changes.

**Architecture:** A new server-only store (`src/lib/loadtest/store.ts`, globalThis + `~/.baklava/loadtests.json`, encrypted-at-rest secrets via a purpose-built redact/merge for the auth union) holds `LoadTest` records each with a `runs[]` history. A zod `SavedLoadTestConfig` (UI auth model with literal secrets) validates input. A pure `toEngineConfig` translator maps literal-secret auth → the engine's env-name auth + an env map (so secrets reach k6 only as container env). A `run-controller` orchestrates a run (create record → call the engine → persist result/status → emit events) and is injectable for tests. API routes under `src/app/api/loadtest/` expose CRUD, run history reads, and a `POST .../run` SSE stream.

**Tech Stack:** TypeScript, zod v4, vitest (`server` project), Next.js route handlers (`runtime="nodejs"`), the iteration-1 `src/lib/loadtest` engine.

> **Scope:** This is Plan A of two. Plan B (UI: TECH_CATALOG tile + `LoadTestSheet`, `loadtest-form.tsx`, `/loadtest/[testId]` workspace with Config/Run/History, result panel) builds on the API delivered here and will be authored after Plan A lands. Spec: `docs/superpowers/specs/2026-06-12-loadtest-workspace-design.md`.

---

## File Structure (Plan A)

| File | Responsibility |
|---|---|
| `src/lib/loadtest/store-schema.ts` | `SavedLoadTestConfig` zod schema (UI auth model w/ literal secrets) + types. |
| `src/lib/loadtest/to-engine-config.ts` | Pure `toEngineConfig(saved, name) → { config, env }` translator. |
| `src/lib/loadtest/store.ts` | Stateful store: persistence, CRUD, run history, redact/merge for secrets. |
| `src/lib/loadtest/server.ts` | `requireLoadTest(id)` (server-only, 404s). |
| `src/lib/loadtest/run-controller.ts` | `executeRun(test, events, opts)` — run lifecycle, injectable runner. |
| `src/app/api/loadtest/route.ts` | `GET` list, `POST` create. |
| `src/app/api/loadtest/[id]/route.ts` | `GET` / `PATCH` / `DELETE` one test. |
| `src/app/api/loadtest/[id]/runs/route.ts` | `GET` run summaries. |
| `src/app/api/loadtest/[id]/runs/[runId]/route.ts` | `GET` one run (full result). |
| `src/app/api/loadtest/[id]/run/route.ts` | `POST` SSE run-and-stream. |
| `*.test.ts` siblings | Unit + API tests (vitest `server`). |

All work happens on branch `feat/loadtest-workspace` (already created).

---

## Task 1: Saved-config schema (`store-schema.ts`)

**Files:**
- Create: `src/lib/loadtest/store-schema.ts`
- Test: `src/lib/loadtest/store-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/store-schema.test.ts
import { describe, it, expect } from "vitest";
import { savedLoadTestConfigSchema } from "./store-schema";

const base = {
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", path: "/items" }],
  profile: { type: "constant", vus: 5, duration: "10s" },
};

describe("savedLoadTestConfigSchema", () => {
  it("parses a minimal config and defaults auth to none", () => {
    const cfg = savedLoadTestConfigSchema.parse(base);
    expect(cfg.auth).toEqual({ type: "none" });
    expect(cfg.requests[0].method).toBe("GET");
  });

  it("accepts literal-secret auth variants", () => {
    expect(savedLoadTestConfigSchema.parse({ ...base, auth: { type: "bearer", token: "t" } }).auth).toEqual({
      type: "bearer",
      token: "t",
    });
    expect(
      savedLoadTestConfigSchema.parse({ ...base, auth: { type: "apiKey", header: "X-Key", value: "v" } }).auth,
    ).toEqual({ type: "apiKey", header: "X-Key", value: "v" });
  });

  it("rejects a non-URL baseUrl and an empty requests array", () => {
    expect(() => savedLoadTestConfigSchema.parse({ ...base, target: { baseUrl: "nope" } })).toThrow();
    expect(() => savedLoadTestConfigSchema.parse({ ...base, requests: [] })).toThrow();
  });

  it("rejects requests whose names collide on metric key", () => {
    expect(() =>
      savedLoadTestConfigSchema.parse({
        ...base,
        requests: [
          { name: "Get Item", path: "/a" },
          { name: "get-item", path: "/b" },
        ],
      }),
    ).toThrow(/collide|metric/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/store-schema.test.ts`
Expected: FAIL — cannot find module `./store-schema`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/loadtest/store-schema.ts
import { z } from "zod";
import { profileSchema, requestStepSchema, thresholdsSchema } from "./schema";
import { metricKey } from "./script-gen";

// UI-facing auth model: holds LITERAL secret values (stored encrypted at rest).
// Translated to the engine's env-name auth at run time by toEngineConfig().
export const savedAuthSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: z.string() }),
  z.object({ type: z.literal("basic"), username: z.string(), password: z.string() }),
  z.object({ type: z.literal("apiKey"), header: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal("customHeaders"), headers: z.record(z.string(), z.string()) }),
]);

export const savedLoadTestConfigSchema = z
  .object({
    target: z.object({
      baseUrl: z.url(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
    requests: z.array(requestStepSchema).min(1),
    auth: savedAuthSchema.default({ type: "none" }),
    profile: profileSchema,
    thresholds: thresholdsSchema,
  })
  // Mirrors the engine's loadTestConfigSchema refine: per-request metric keys
  // must be unique or the generated k6 script declares duplicate consts.
  .superRefine((cfg, ctx) => {
    const seen = new Map<string, number>();
    cfg.requests.forEach((r, i) => {
      const key = metricKey(r.name);
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["requests", i, "name"],
          message: `Request name "${r.name}" collides with "${cfg.requests[seen.get(key)!].name}" (both map to metric "${key}"). Use distinct names.`,
        });
      } else {
        seen.set(key, i);
      }
    });
  });

export type SavedAuth = z.infer<typeof savedAuthSchema>;
export type SavedLoadTestConfig = z.infer<typeof savedLoadTestConfigSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/store-schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/store-schema.ts src/lib/loadtest/store-schema.test.ts
git commit -m "feat(loadtest): SavedLoadTestConfig schema (UI auth model)"
```

---

## Task 2: UI-auth → engine translator (`to-engine-config.ts`)

**Files:**
- Create: `src/lib/loadtest/to-engine-config.ts`
- Test: `src/lib/loadtest/to-engine-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/to-engine-config.test.ts
import { describe, it, expect } from "vitest";
import { toEngineConfig } from "./to-engine-config";
import { savedLoadTestConfigSchema } from "./store-schema";

function parse(authPart: object) {
  return savedLoadTestConfigSchema.parse({
    target: { baseUrl: "https://api.example.com" },
    requests: [{ name: "list", path: "/items" }],
    profile: { type: "constant", vus: 1, duration: "1s" },
    ...authPart,
  });
}

describe("toEngineConfig", () => {
  it("passes through non-secret fields and sets the name", () => {
    const { config, env } = toEngineConfig(parse({}), "My Test");
    expect(config.name).toBe("My Test");
    expect(config.target.baseUrl).toBe("https://api.example.com");
    expect(config.requests).toHaveLength(1);
    expect(config.auth).toEqual({ type: "none" });
    expect(env).toEqual({});
  });

  it("maps bearer to env-name auth + env map", () => {
    const { config, env } = toEngineConfig(parse({ auth: { type: "bearer", token: "abc" } }), "t");
    expect(config.auth).toEqual({ type: "bearer", tokenEnv: "LT_BEARER" });
    expect(env).toEqual({ LT_BEARER: "abc" });
  });

  it("maps basic to two env vars", () => {
    const { config, env } = toEngineConfig(
      parse({ auth: { type: "basic", username: "u", password: "p" } }),
      "t",
    );
    expect(config.auth).toEqual({
      type: "basic",
      usernameEnv: "LT_BASIC_USER",
      passwordEnv: "LT_BASIC_PASS",
    });
    expect(env).toEqual({ LT_BASIC_USER: "u", LT_BASIC_PASS: "p" });
  });

  it("maps apiKey preserving the header name", () => {
    const { config, env } = toEngineConfig(
      parse({ auth: { type: "apiKey", header: "X-Api-Key", value: "k" } }),
      "t",
    );
    expect(config.auth).toEqual({ type: "apiKey", header: "X-Api-Key", valueEnv: "LT_APIKEY" });
    expect(env).toEqual({ LT_APIKEY: "k" });
  });

  it("maps customHeaders to indexed env vars (collision-free)", () => {
    const { config, env } = toEngineConfig(
      parse({ auth: { type: "customHeaders", headers: { "X-A": "1", "X-B": "2" } } }),
      "t",
    );
    expect(config.auth).toEqual({
      type: "customHeaders",
      headersEnv: { "X-A": "LT_CUSTOM_0", "X-B": "LT_CUSTOM_1" },
    });
    expect(env).toEqual({ LT_CUSTOM_0: "1", LT_CUSTOM_1: "2" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/to-engine-config.test.ts`
Expected: FAIL — cannot find module `./to-engine-config`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/loadtest/to-engine-config.ts
import type { Auth, LoadTestConfig } from "./schema";
import type { SavedLoadTestConfig } from "./store-schema";

/**
 * Translate a UI-facing saved config (literal secret values) into the engine's
 * LoadTestConfig (auth references env-var NAMES) plus the env map of resolved
 * values. This keeps the engine unchanged and preserves its property that
 * secrets reach k6 only as container env, never embedded in the script text.
 */
export function toEngineConfig(
  saved: SavedLoadTestConfig,
  name: string,
): { config: LoadTestConfig; env: Record<string, string> } {
  const env: Record<string, string> = {};
  let auth: Auth;

  switch (saved.auth.type) {
    case "none":
      auth = { type: "none" };
      break;
    case "bearer":
      env.LT_BEARER = saved.auth.token;
      auth = { type: "bearer", tokenEnv: "LT_BEARER" };
      break;
    case "basic":
      env.LT_BASIC_USER = saved.auth.username;
      env.LT_BASIC_PASS = saved.auth.password;
      auth = { type: "basic", usernameEnv: "LT_BASIC_USER", passwordEnv: "LT_BASIC_PASS" };
      break;
    case "apiKey":
      env.LT_APIKEY = saved.auth.value;
      auth = { type: "apiKey", header: saved.auth.header, valueEnv: "LT_APIKEY" };
      break;
    case "customHeaders": {
      const headersEnv: Record<string, string> = {};
      Object.entries(saved.auth.headers).forEach(([header, value], i) => {
        const envName = `LT_CUSTOM_${i}`;
        env[envName] = value;
        headersEnv[header] = envName;
      });
      auth = { type: "customHeaders", headersEnv };
      break;
    }
  }

  const config: LoadTestConfig = {
    name,
    target: saved.target,
    requests: saved.requests,
    auth,
    profile: saved.profile,
    thresholds: saved.thresholds,
  };
  return { config, env };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/to-engine-config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/to-engine-config.ts src/lib/loadtest/to-engine-config.test.ts
git commit -m "feat(loadtest): UI-auth -> engine config translator"
```

---

## Task 3: Store + persistence + secrets + history (`store.ts`, `server.ts`)

**Files:**
- Create: `src/lib/loadtest/store.ts`
- Create: `src/lib/loadtest/server.ts`
- Test: `src/lib/loadtest/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/store.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mirrors the connections store test harness: set BAKLAVA_DATA_DIR before
// import, clear the globalThis cache, reset modules, re-import fresh.
async function freshStore(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  return import("./store");
}

const CONFIG = {
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", method: "GET" as const, path: "/items" }],
  auth: { type: "bearer" as const, token: "super-secret-token" },
  profile: { type: "constant" as const, vus: 1, duration: "1s" },
};

describe("loadtest store", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-store-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("saves, persists to a 0600 file, and reloads", async () => {
    const s1 = await freshStore(dataDir);
    const saved = s1.saveLoadTest({ name: "T1", config: CONFIG });
    expect(saved.id).toBeTruthy();
    expect(saved.runs).toEqual([]);
    const file = join(dataDir, "loadtests.json");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const s2 = await freshStore(dataDir);
    const reloaded = s2.getLoadTest(saved.id);
    expect(reloaded?.name).toBe("T1");
    expect(reloaded?.config.auth).toEqual({ type: "bearer", token: "super-secret-token" });
  });

  it("redacts secrets in the public view", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    const pub = s.publicLoadTest(s.getLoadTest(saved.id)!);
    expect(pub.config.auth.type).toBe("bearer");
    // token masked, not plaintext
    expect((pub.config.auth as { token: string }).token).not.toBe("super-secret-token");
    expect((pub.config.auth as { token: string }).token.length).toBeGreaterThan(0);
  });

  it("preserves a secret on update when the field is blank", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    const updated = s.updateLoadTest(saved.id, {
      config: { ...CONFIG, auth: { type: "bearer", token: "" } },
    });
    expect(updated?.config.auth).toEqual({ type: "bearer", token: "super-secret-token" });
  });

  it("replaces a secret on update when a new value is provided", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    const updated = s.updateLoadTest(saved.id, {
      config: { ...CONFIG, auth: { type: "bearer", token: "new-token" } },
    });
    expect(updated?.config.auth).toEqual({ type: "bearer", token: "new-token" });
  });

  it("appends runs, caps history at 50, and reports newest first", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    let last;
    for (let i = 0; i < 55; i++) {
      last = s.appendRun(saved.id, { startedAt: 1000 + i, status: "passed" });
    }
    const runs = s.listRuns(saved.id);
    expect(runs).toHaveLength(50);
    expect(runs[0].id).toBe(last!.id); // newest first
  });

  it("updateRun patches status/result and getRun returns it", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    const run = s.appendRun(saved.id, { startedAt: 1, status: "running" });
    const done = s.updateRun(saved.id, run.id, { status: "passed", finishedAt: 2 });
    expect(done?.status).toBe("passed");
    expect(s.getRun(saved.id, run.id)?.finishedAt).toBe(2);
  });

  it("reconciles a 'running' run to 'error' after a process restart", async () => {
    const s1 = await freshStore(dataDir);
    const saved = s1.saveLoadTest({ name: "T", config: CONFIG });
    s1.appendRun(saved.id, { startedAt: 1, status: "running" });
    const s2 = await freshStore(dataDir); // simulate restart
    expect(s2.listRuns(saved.id)[0].status).toBe("error");
  });

  it("deletes a test", async () => {
    const s = await freshStore(dataDir);
    const saved = s.saveLoadTest({ name: "T", config: CONFIG });
    expect(s.deleteLoadTest(saved.id)).toBe(true);
    expect(s.getLoadTest(saved.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/store.test.ts`
Expected: FAIL — cannot find module `./store`.

- [ ] **Step 3: Write `src/lib/loadtest/store.ts`**

```ts
// src/lib/loadtest/store.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LoadTestResult } from "./results";
import type { SavedAuth, SavedLoadTestConfig } from "./store-schema";

export type RunStatus = "running" | "passed" | "failed" | "error" | "cancelled";

export interface LoadTestRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  result?: LoadTestResult;
  error?: string;
}

export interface LoadTest {
  id: string;
  name: string;
  config: SavedLoadTestConfig;
  createdAt: number;
  updatedAt: number;
  runs: LoadTestRun[];
}

export interface RunSummary {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: RunStatus;
  passed?: boolean;
  p95?: number;
  rps?: number;
  errorRate?: number;
}

export interface PublicLoadTest {
  id: string;
  name: string;
  config: SavedLoadTestConfig;
  createdAt: number;
  updatedAt: number;
  runCount: number;
  lastRun?: RunSummary;
}

const MAX_RUNS = 50;

const DATA_DIR = process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
const FILE = path.join(DATA_DIR, "loadtests.json");

interface PersistedShape {
  version: 1;
  loadtests: LoadTest[];
}

function loadFromDisk(): LoadTest[] {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const data = JSON.parse(raw) as Partial<PersistedShape>;
    if (!Array.isArray(data?.loadtests)) return [];
    // Any run left "running" was interrupted by a process restart — it can
    // never resume (runs are page-tied), so mark it errored.
    for (const t of data.loadtests) {
      for (const r of t.runs ?? []) {
        if (r.status === "running") {
          r.status = "error";
          r.error = "interrupted (process restarted)";
          r.finishedAt = r.finishedAt ?? Date.now();
        }
      }
    }
    return data.loadtests;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") console.warn(`[baklava] could not read ${FILE}:`, err);
    return [];
  }
}

function persistToDisk(records: LoadTest[]): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const payload: PersistedShape = { version: 1, loadtests: records };
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error(`[baklava] could not persist ${FILE}:`, err);
  }
}

const globalKey = Symbol.for("baklava.loadtestStore");
interface Store {
  byId: Map<string, LoadTest>;
}

function getStore(): Store {
  const g = globalThis as unknown as Record<symbol, Store>;
  if (!g[globalKey]) {
    const byId = new Map<string, LoadTest>();
    for (const rec of loadFromDisk()) if (rec?.id) byId.set(rec.id, rec);
    g[globalKey] = { byId };
  }
  return g[globalKey];
}

function flush(): void {
  persistToDisk([...getStore().byId.values()]);
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ── Secret handling (purpose-built for the auth union) ──────────────────────

function maskSecret(value: string): string {
  return value.length ? "•".repeat(Math.min(value.length, 8)) : "";
}

function redactAuth(auth: SavedAuth): SavedAuth {
  switch (auth.type) {
    case "bearer":
      return { type: "bearer", token: maskSecret(auth.token) };
    case "basic":
      return { type: "basic", username: auth.username, password: maskSecret(auth.password) };
    case "apiKey":
      return { type: "apiKey", header: auth.header, value: maskSecret(auth.value) };
    case "customHeaders":
      return {
        type: "customHeaders",
        headers: Object.fromEntries(
          Object.entries(auth.headers).map(([h, v]) => [h, maskSecret(v)]),
        ),
      };
    case "none":
      return { type: "none" };
  }
}

// Keep an existing secret when the incoming value is blank (the
// "(unchanged — leave blank to keep)" pattern). Only applies when the auth
// type is unchanged; a type switch resets secrets.
function mergeAuth(existing: SavedAuth, patch: SavedAuth): SavedAuth {
  if (patch.type !== existing.type) return patch;
  switch (patch.type) {
    case "bearer":
      return { type: "bearer", token: patch.token || (existing as typeof patch).token };
    case "basic":
      return {
        type: "basic",
        username: patch.username,
        password: patch.password || (existing as typeof patch).password,
      };
    case "apiKey":
      return {
        type: "apiKey",
        header: patch.header,
        value: patch.value || (existing as typeof patch).value,
      };
    case "customHeaders": {
      const prev = (existing as typeof patch).headers;
      const headers = Object.fromEntries(
        Object.entries(patch.headers).map(([h, v]) => [h, v || prev[h] || ""]),
      );
      return { type: "customHeaders", headers };
    }
    case "none":
      return { type: "none" };
  }
}

// ── Run summaries / public view ─────────────────────────────────────────────

export function runSummary(run: LoadTestRun): RunSummary {
  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    passed: run.result?.passed,
    p95: run.result?.latency.p95,
    rps: run.result?.rps,
    errorRate: run.result?.errorRate,
  };
}

export function publicLoadTest(test: LoadTest): PublicLoadTest {
  return {
    id: test.id,
    name: test.name,
    config: { ...test.config, auth: redactAuth(test.config.auth) },
    createdAt: test.createdAt,
    updatedAt: test.updatedAt,
    runCount: test.runs.length,
    lastRun: test.runs.length ? runSummary(test.runs[test.runs.length - 1]) : undefined,
  };
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function listLoadTests(): LoadTest[] {
  return [...getStore().byId.values()];
}

export function getLoadTest(id: string): LoadTest | undefined {
  return getStore().byId.get(id);
}

export function saveLoadTest(input: { name: string; config: SavedLoadTestConfig }): LoadTest {
  const now = Date.now();
  const record: LoadTest = {
    id: genId(),
    name: input.name,
    config: input.config,
    createdAt: now,
    updatedAt: now,
    runs: [],
  };
  getStore().byId.set(record.id, record);
  flush();
  return record;
}

export function updateLoadTest(
  id: string,
  patch: { name?: string; config?: SavedLoadTestConfig },
): LoadTest | undefined {
  const existing = getStore().byId.get(id);
  if (!existing) return undefined;
  const config = patch.config
    ? { ...patch.config, auth: mergeAuth(existing.config.auth, patch.config.auth) }
    : existing.config;
  const updated: LoadTest = {
    ...existing,
    name: patch.name?.trim() || existing.name,
    config,
    updatedAt: Date.now(),
  };
  getStore().byId.set(id, updated);
  flush();
  return updated;
}

export function deleteLoadTest(id: string): boolean {
  const deleted = getStore().byId.delete(id);
  if (deleted) flush();
  return deleted;
}

// ── Runs ────────────────────────────────────────────────────────────────────

export function appendRun(
  testId: string,
  input: { startedAt: number; status: RunStatus },
): LoadTestRun {
  const test = getStore().byId.get(testId);
  if (!test) throw new Error(`load test not found: ${testId}`);
  const run: LoadTestRun = { id: genId(), startedAt: input.startedAt, status: input.status };
  test.runs.push(run);
  if (test.runs.length > MAX_RUNS) test.runs.splice(0, test.runs.length - MAX_RUNS);
  flush();
  return run;
}

export function updateRun(
  testId: string,
  runId: string,
  patch: Partial<Omit<LoadTestRun, "id">>,
): LoadTestRun | undefined {
  const test = getStore().byId.get(testId);
  if (!test) return undefined;
  const run = test.runs.find((r) => r.id === runId);
  if (!run) return undefined;
  Object.assign(run, patch);
  flush();
  return run;
}

/** Runs newest-first. */
export function listRuns(testId: string): LoadTestRun[] {
  const test = getStore().byId.get(testId);
  if (!test) return [];
  return [...test.runs].reverse();
}

export function getRun(testId: string, runId: string): LoadTestRun | undefined {
  return getStore().byId.get(testId)?.runs.find((r) => r.id === runId);
}
```

- [ ] **Step 4: Create `src/lib/loadtest/server.ts`**

```ts
// src/lib/loadtest/server.ts
import "server-only";
import { notFound } from "next/navigation";
import { getLoadTest, type LoadTest } from "./store";

export function requireLoadTest(id: string): LoadTest {
  const test = getLoadTest(id);
  if (!test) notFound();
  return test;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/loadtest/store.ts src/lib/loadtest/server.ts src/lib/loadtest/store.test.ts
git commit -m "feat(loadtest): saved-test store with persistence, secrets, run history"
```

---

## Task 4: Run controller (`run-controller.ts`)

**Files:**
- Create: `src/lib/loadtest/run-controller.ts`
- Test: `src/lib/loadtest/run-controller.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/run-controller.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fresh(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  const [store, controller] = await Promise.all([import("./store"), import("./run-controller")]);
  return { store, controller };
}

const CONFIG = {
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", method: "GET" as const, path: "/items" }],
  auth: { type: "bearer" as const, token: "tok" },
  profile: { type: "constant" as const, vus: 1, duration: "1s" },
};

function fakeResult(passed: boolean) {
  return {
    name: "x",
    passed,
    latency: { avg: 1, min: 1, p50: 1, max: 1, p90: 1, p95: 2, p99: 3 },
    totalRequests: 10,
    rps: 5,
    errorRate: 0,
    vusMax: 1,
    dataSent: 1,
    dataReceived: 1,
    requests: [],
    thresholds: [],
  };
}

describe("executeRun", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-run-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("runs, streams progress+result, and persists status from passed", async () => {
    const { store, controller } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    const events: string[] = [];
    const runner = async (_config: unknown, opts: { onProgress?: (p: { line: string }) => void }) => {
      opts.onProgress?.({ line: "running 1/1" });
      return fakeResult(true);
    };
    const run = await controller.executeRun(
      test,
      {
        onProgress: (l) => events.push(`p:${l}`),
        onResult: () => events.push("result"),
        onError: () => events.push("error"),
      },
      { runner },
    );
    expect(run.status).toBe("passed");
    expect(events).toEqual(["p:running 1/1", "result"]);
    expect(store.getRun(test.id, run.id)?.result?.rps).toBe(5);
  });

  it("persists status 'failed' when result.passed is false", async () => {
    const { store, controller } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    const run = await controller.executeRun(
      test,
      { onProgress: () => {}, onResult: () => {}, onError: () => {} },
      { runner: async () => fakeResult(false) },
    );
    expect(run.status).toBe("failed");
  });

  it("emits error and persists 'error' when the runner throws", async () => {
    const { store, controller } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    let errMsg = "";
    const run = await controller.executeRun(
      test,
      { onProgress: () => {}, onResult: () => {}, onError: (m) => (errMsg = m) },
      {
        runner: async () => {
          throw new Error("docker down");
        },
      },
    );
    expect(run.status).toBe("error");
    expect(errMsg).toMatch(/docker down/);
    expect(store.getRun(test.id, run.id)?.error).toMatch(/docker down/);
  });

  it("persists 'cancelled' when the signal is aborted", async () => {
    const { store, controller } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    const ac = new AbortController();
    ac.abort();
    const run = await controller.executeRun(
      test,
      { onProgress: () => {}, onResult: () => {}, onError: () => {} },
      {
        signal: ac.signal,
        runner: async () => {
          throw new Error("aborted");
        },
      },
    );
    expect(run.status).toBe("cancelled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/run-controller.test.ts`
Expected: FAIL — cannot find module `./run-controller`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/loadtest/run-controller.ts
import { formatError } from "@/lib/errors";
import type { LoadTestResult } from "./results";
import { runLoadTest, type RunOptions } from "./run-load-test";
import { appendRun, updateRun, type LoadTest, type LoadTestRun } from "./store";
import { toEngineConfig } from "./to-engine-config";

export interface RunEvents {
  onProgress: (line: string) => void;
  onResult: (result: LoadTestResult) => void;
  onError: (message: string) => void;
}

export type Runner = (input: unknown, opts: RunOptions) => Promise<LoadTestResult>;

export interface ExecuteRunOptions {
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the real engine. */
  runner?: Runner;
}

/**
 * Orchestrate one run: create a run record, invoke the engine (translating the
 * saved config + secrets), stream events, and persist the terminal status.
 * Threshold breach → "failed" (NOT an error). Abort → "cancelled".
 */
export async function executeRun(
  test: LoadTest,
  events: RunEvents,
  opts: ExecuteRunOptions = {},
): Promise<LoadTestRun> {
  const runner = opts.runner ?? runLoadTest;
  const { config, env } = toEngineConfig(test.config, test.name);
  const run = appendRun(test.id, { startedAt: Date.now(), status: "running" });

  try {
    const result = await runner(config, {
      env,
      signal: opts.signal,
      onProgress: (p) => events.onProgress(p.line),
    });
    events.onResult(result);
    return updateRun(test.id, run.id, {
      status: result.passed ? "passed" : "failed",
      result,
      finishedAt: Date.now(),
    })!;
  } catch (err) {
    if (opts.signal?.aborted) {
      return updateRun(test.id, run.id, { status: "cancelled", finishedAt: Date.now() })!;
    }
    const message = formatError(err);
    events.onError(message);
    return updateRun(test.id, run.id, { status: "error", error: message, finishedAt: Date.now() })!;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/run-controller.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/run-controller.ts src/lib/loadtest/run-controller.test.ts
git commit -m "feat(loadtest): run controller (lifecycle + injectable runner)"
```

---

## Task 5: CRUD API routes (`/api/loadtest`, `/api/loadtest/[id]`)

**Files:**
- Create: `src/app/api/loadtest/route.ts`
- Create: `src/app/api/loadtest/[id]/route.ts`
- Test: `src/app/api/loadtest/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/loadtest/route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function freshRoutes(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  const [listRoute, idRoute, store] = await Promise.all([
    import("./route"),
    import("./[id]/route"),
    import("@/lib/loadtest/store"),
  ]);
  return { listRoute, idRoute, store };
}

const BODY = {
  name: "My Test",
  config: {
    target: { baseUrl: "https://api.example.com" },
    requests: [{ name: "list", path: "/items" }],
    auth: { type: "bearer", token: "secret-token" },
    profile: { type: "constant", vus: 1, duration: "1s" },
  },
};

function post(body: unknown) {
  return new Request("http://localhost/api/loadtest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("loadtest CRUD API", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-api-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("POST creates a test and GET lists it with secrets redacted", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    const created = await listRoute.POST(post(BODY));
    expect(created.status).toBe(201);

    const listRes = await listRoute.GET();
    const data = (await listRes.json()) as { loadtests: { name: string; config: { auth: { token: string } } }[] };
    expect(data.loadtests).toHaveLength(1);
    expect(data.loadtests[0].name).toBe("My Test");
    expect(data.loadtests[0].config.auth.token).not.toBe("secret-token");
  });

  it("POST rejects an invalid config with 400", async () => {
    const { listRoute } = await freshRoutes(dataDir);
    const res = await listRoute.POST(post({ name: "x", config: { target: { baseUrl: "nope" }, requests: [], profile: {} } }));
    expect(res.status).toBe(400);
  });

  it("GET [id] returns redacted test; 404 when missing", async () => {
    const { listRoute, idRoute, store } = await freshRoutes(dataDir);
    await listRoute.POST(post(BODY));
    const id = store.listLoadTests()[0].id;

    const ok = await idRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id }) });
    expect(ok.status).toBe(200);
    const miss = await idRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: "nope" }) });
    expect(miss.status).toBe(404);
  });

  it("PATCH preserves the token when blank; DELETE removes the test", async () => {
    const { listRoute, idRoute, store } = await freshRoutes(dataDir);
    await listRoute.POST(post(BODY));
    const id = store.listLoadTests()[0].id;

    const patchReq = new Request("http://localhost", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed", config: { ...BODY.config, auth: { type: "bearer", token: "" } } }),
    });
    const patched = await idRoute.PATCH(patchReq, { params: Promise.resolve({ id }) });
    expect(patched.status).toBe(200);
    expect(store.getLoadTest(id)?.name).toBe("Renamed");
    expect(store.getLoadTest(id)?.config.auth).toEqual({ type: "bearer", token: "secret-token" });

    const del = await idRoute.DELETE(new Request("http://localhost"), { params: Promise.resolve({ id }) });
    expect(del.status).toBe(200);
    expect(store.getLoadTest(id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/loadtest/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write `src/app/api/loadtest/route.ts`**

```ts
// src/app/api/loadtest/route.ts
import { NextResponse } from "next/server";
import { formatError } from "@/lib/errors";
import { savedLoadTestConfigSchema } from "@/lib/loadtest/store-schema";
import { listLoadTests, publicLoadTest, saveLoadTest } from "@/lib/loadtest/store";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ loadtests: listLoadTests().map(publicLoadTest) });
}

const createSchema = z.object({
  name: z.string().min(1),
  config: savedLoadTestConfigSchema,
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  try {
    const saved = saveLoadTest({ name: parsed.data.name, config: parsed.data.config });
    return NextResponse.json({ loadtest: publicLoadTest(saved) }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}
```

> Note: `z.prettifyError` is zod v4's formatter. If it is unavailable in the installed version, use `parsed.error.message` instead (a JSON string of issues) — the test only checks the 400 status, not the body shape.

- [ ] **Step 4: Write `src/app/api/loadtest/[id]/route.ts`**

```ts
// src/app/api/loadtest/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { formatError } from "@/lib/errors";
import { savedLoadTestConfigSchema } from "@/lib/loadtest/store-schema";
import { deleteLoadTest, getLoadTest, publicLoadTest, updateLoadTest } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const test = getLoadTest(id);
  if (!test) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ loadtest: publicLoadTest(test) });
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  config: savedLoadTestConfigSchema.optional(),
});

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!getLoadTest(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  }
  try {
    const updated = updateLoadTest(id, parsed.data);
    return NextResponse.json({ loadtest: publicLoadTest(updated!) });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const ok = deleteLoadTest(id);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/app/api/loadtest/route.test.ts`
Expected: PASS (4 tests). If a `z.prettifyError` type/runtime error occurs, apply the fallback noted in Step 3 in both route files.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/loadtest/route.ts src/app/api/loadtest/[id]/route.ts src/app/api/loadtest/route.test.ts
git commit -m "feat(loadtest): CRUD API routes for saved tests"
```

---

## Task 6: Run-history read routes (`[id]/runs`, `[id]/runs/[runId]`)

**Files:**
- Create: `src/app/api/loadtest/[id]/runs/route.ts`
- Create: `src/app/api/loadtest/[id]/runs/[runId]/route.ts`
- Test: `src/app/api/loadtest/[id]/runs/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/loadtest/[id]/runs/route.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fresh(dataDir: string) {
  process.env.BAKLAVA_DATA_DIR = dataDir;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("baklava.loadtestStore")];
  vi.resetModules();
  const [runsRoute, runRoute, store] = await Promise.all([
    import("./route"),
    import("./[runId]/route"),
    import("@/lib/loadtest/store"),
  ]);
  return { runsRoute, runRoute, store };
}

const CONFIG = {
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", method: "GET" as const, path: "/items" }],
  auth: { type: "none" as const },
  profile: { type: "constant" as const, vus: 1, duration: "1s" },
};

describe("loadtest runs read API", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "baklava-lt-runs-"));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("GET runs returns newest-first summaries", async () => {
    const { runsRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    store.appendRun(test.id, { startedAt: 1, status: "passed" });
    const r2 = store.appendRun(test.id, { startedAt: 2, status: "failed" });

    const res = await runsRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ id: test.id }) });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { runs: { id: string; status: string }[] };
    expect(data.runs[0].id).toBe(r2.id);
    expect(data.runs).toHaveLength(2);
  });

  it("GET one run returns the full record; 404 when missing", async () => {
    const { runRoute, store } = await fresh(dataDir);
    const test = store.saveLoadTest({ name: "T", config: CONFIG });
    const run = store.appendRun(test.id, { startedAt: 1, status: "passed" });

    const ok = await runRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id, runId: run.id }),
    });
    expect(ok.status).toBe(200);
    const miss = await runRoute.GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: test.id, runId: "nope" }),
    });
    expect(miss.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/api/loadtest/[id]/runs/route.test.ts"`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write `src/app/api/loadtest/[id]/runs/route.ts`**

```ts
// src/app/api/loadtest/[id]/runs/route.ts
import { NextResponse } from "next/server";
import { getLoadTest, listRuns, runSummary } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  if (!getLoadTest(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ runs: listRuns(id).map(runSummary) });
}
```

- [ ] **Step 4: Write `src/app/api/loadtest/[id]/runs/[runId]/route.ts`**

```ts
// src/app/api/loadtest/[id]/runs/[runId]/route.ts
import { NextResponse } from "next/server";
import { getRun } from "@/lib/loadtest/store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; runId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { id, runId } = await ctx.params;
  const run = getRun(id, runId);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run "src/app/api/loadtest/[id]/runs/route.test.ts"`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/loadtest/[id]/runs/route.ts" "src/app/api/loadtest/[id]/runs/[runId]/route.ts" "src/app/api/loadtest/[id]/runs/route.test.ts"
git commit -m "feat(loadtest): run-history read routes"
```

---

## Task 7: Run-and-stream route (`[id]/run`)

**Files:**
- Create: `src/app/api/loadtest/[id]/run/route.ts`

> This route is thin SSE glue over `executeRun` (Task 4, already unit-tested with an injected runner). It calls the real engine (Docker), so it is verified by typecheck + build here, not a unit test. The k6 path itself is covered by the engine's `BAKLAVA_INTEGRATION` test.

- [ ] **Step 1: Write the implementation**

```ts
// src/app/api/loadtest/[id]/run/route.ts
import { getLoadTest } from "@/lib/loadtest/store";
import { executeRun } from "@/lib/loadtest/run-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const test = getLoadTest(id);
  if (!test) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        try {
          controller.enqueue(chunk);
        } catch {
          /* closed */
        }
      };
      // 15s heartbeat keeps Next dev / proxies from dropping the connection.
      const heartbeat = setInterval(() => safeEnqueue(encoder.encode(": ping\n\n")), 15_000);

      try {
        const run = await executeRun(
          test,
          {
            onProgress: (line) => safeEnqueue(sse("progress", { line })),
            onResult: (result) => safeEnqueue(sse("result", result)),
            onError: (message) => safeEnqueue(sse("error", { message })),
          },
          { signal: req.signal },
        );
        safeEnqueue(sse("done", { runId: run.id, status: run.status }));
      } catch (err) {
        safeEnqueue(sse("error", { message: err instanceof Error ? err.message : String(err) }));
      } finally {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Verify typecheck + lint + the loadtest unit suite**

Run: `npm run typecheck && npm run lint && npx vitest run src/lib/loadtest src/app/api/loadtest`
Expected: typecheck clean, lint clean, all unit/API tests pass (the run route has no unit test; `executeRun` covers its logic).

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/loadtest/[id]/run/route.ts"
git commit -m "feat(loadtest): POST run-and-stream SSE route"
```

---

## Task 8: Plan-A verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `npm run test`
Expected: PASS (existing 376 + the new loadtest store/schema/translator/controller/API tests).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; the new `/api/loadtest/...` routes appear in the route list.

- [ ] **Step 4: (Optional, Docker available) End-to-end API smoke**

Start the dev server (`npm run dev`) in one shell, then:
```bash
# create a test
curl -s -X POST localhost:3000/api/loadtest -H 'content-type: application/json' -d '{
  "name":"httpbin","config":{
    "target":{"baseUrl":"https://httpbin.org"},
    "requests":[{"name":"get","method":"GET","path":"/get","checks":{"status":200}}],
    "profile":{"type":"constant","vus":2,"duration":"3s"},
    "thresholds":{"p95":5000,"errorRate":0.5}}}'
# note the returned id, then stream a run:
curl -N -X POST localhost:3000/api/loadtest/<ID>/run
# expect: event: progress lines, an event: result with metrics, event: done
curl -s localhost:3000/api/loadtest/<ID>/runs   # the run persisted in history
```
If Docker is unavailable, the run streams an `event: error` with a clear message — acceptable; the gate is Steps 1–3.

- [ ] **Step 5: Finish**

Plan A complete. Proceed to author **Plan B (UI)** (brainstorm already done; spec section 4–5 cover it), or pause for review. Do NOT merge to main until Plan B lands if you want the feature shipped whole — or merge A independently (the API is usable on its own).

---

## Self-Review Notes (Plan A)

- **Spec coverage:** store/persistence/secrets → Task 3; `toEngineConfig` translator → Task 2; `SavedLoadTestConfig` schema → Task 1; CRUD API → Task 5; run-history reads → Task 6; run-and-stream SSE → Task 7; run lifecycle (passed/failed/error/cancelled) → Task 4; encrypted-at-rest + redaction + secret-preserving merge → Task 3; history cap + running→error reconciliation → Task 3. Engine unchanged (Task 2 adapts at the boundary).
- **Type consistency:** `metricKey` reused from `script-gen` in Task 1; `SavedAuth`/`SavedLoadTestConfig` defined in Task 1 and consumed in Tasks 2/3/5; `LoadTest`/`LoadTestRun`/`RunStatus`/`RunSummary`/`PublicLoadTest` defined in Task 3 and consumed in Tasks 4/5/6/7; `executeRun`/`RunEvents`/`Runner` defined in Task 4 and consumed in Task 7; `runLoadTest`'s `RunOptions` (executor/onProgress/signal/env) consumed by the `Runner` type.
- **Deferred to Plan B (UI):** TECH_CATALOG tile + "Testing" category, `tech-grid` branch, `LoadTestSheet`, `loadtest-form.tsx`, `/loadtest/[testId]` workspace (layout + Config/Run/History pages + `run-client.tsx`), result panel components, `requireLoadTest` is created here (Task 3) ready for the Plan-B layout.
