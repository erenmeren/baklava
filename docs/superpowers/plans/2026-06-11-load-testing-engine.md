# Load-Testing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, UI-independent TypeScript load-testing engine that wraps k6 (run via the `grafana/k6` Docker image) and exposes `runLoadTest(config) → LoadTestResult`, plus a CLI adapter.

**Architecture:** Pure-TS core in `src/lib/loadtest/` — a zod config schema, a pure k6-script generator, a results parser, and an orchestrator that runs a pluggable `Executor`. The default `K6DockerExecutor` uses the existing `dockerode` dependency to run `grafana/k6`: the generated script is piped to `k6 run -` over **stdin**, and the summary is returned over **stdout** via a `handleSummary()` that brackets the JSON with sentinel markers (zero bind-mounts; nothing written to the repo). Secrets are passed as container env vars and referenced as `__ENV.*` in the script, never hardcoded. A thin CLI (`scripts/loadtest.ts`) reads a config file, streams progress, prints a summary, and exits non-zero on threshold failure.

**Tech Stack:** TypeScript, zod v4, dockerode v5 (existing dep), k6 (via `grafana/k6` image), vitest (unit + `BAKLAVA_INTEGRATION` integration), tsx (CLI runner, added in Task 7).

> **Spec refinement note:** The approved spec (`docs/superpowers/specs/2026-06-11-load-testing-engine-design.md`) described "script via stdin + summary via a bind-mounted temp dir." This plan keeps the stdin script feed but returns the summary over **stdout** (via `handleSummary` markers) instead of a mounted file. This is strictly simpler — zero bind-mounts — and fully honors the spec's intent (no scripts written to the repo, secrets never hardcoded). Everything else matches the spec.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/loadtest/schema.ts` | zod schemas + inferred types for `LoadTestConfig`; `requiredEnvVars(auth)`. |
| `src/lib/loadtest/url.ts` | `rewriteLocalhostForDocker(baseUrl)` — localhost → host.docker.internal. |
| `src/lib/loadtest/script-gen.ts` | Pure `generateK6Script(config)` + helpers (`profileToScenario`, `thresholdsToK6`, `metricKey`). |
| `src/lib/loadtest/results.ts` | `parseSummary(summary, config) → LoadTestResult`; result types. |
| `src/lib/loadtest/executor.ts` | `Executor` interface + `RunOpts` / `RawRunOutput` / `Progress` types. |
| `src/lib/loadtest/executors/k6-docker.ts` | `K6DockerExecutor` — runs `grafana/k6` via dockerode. |
| `src/lib/loadtest/run-load-test.ts` | `runLoadTest(input, opts) → LoadTestResult` orchestrator. |
| `src/lib/loadtest/index.ts` | Public barrel export. |
| `scripts/loadtest.ts` | CLI adapter. |
| `examples/loadtest/httpbin.json` | Example config. |
| `*.test.ts` siblings | Unit tests (vitest `server` project). |
| `src/lib/loadtest/executors/k6-docker.integration.test.ts` | Integration test (gated by `BAKLAVA_INTEGRATION=1`). |

All work happens on branch `feat/loadtest-engine` (already created).

---

## Task 1: Config schema (`schema.ts`)

**Files:**
- Create: `src/lib/loadtest/schema.ts`
- Test: `src/lib/loadtest/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/schema.test.ts
import { describe, it, expect } from "vitest";
import { loadTestConfigSchema, requiredEnvVars } from "./schema";

describe("loadTestConfigSchema", () => {
  it("parses a minimal config and applies defaults", () => {
    const cfg = loadTestConfigSchema.parse({
      target: { baseUrl: "https://api.example.com" },
      requests: [{ name: "home", path: "/" }],
      profile: { type: "constant", vus: 5, duration: "10s" },
    });
    expect(cfg.name).toBe("loadtest");
    expect(cfg.auth).toEqual({ type: "none" });
    expect(cfg.requests[0].method).toBe("GET");
  });

  it("rejects an empty requests array", () => {
    expect(() =>
      loadTestConfigSchema.parse({
        target: { baseUrl: "https://x.test" },
        requests: [],
        profile: { type: "constant", vus: 1, duration: "1s" },
      }),
    ).toThrow();
  });

  it("rejects a non-URL baseUrl", () => {
    expect(() =>
      loadTestConfigSchema.parse({
        target: { baseUrl: "not-a-url" },
        requests: [{ name: "a", path: "/" }],
        profile: { type: "constant", vus: 1, duration: "1s" },
      }),
    ).toThrow();
  });

  it("requiredEnvVars lists env names per auth type", () => {
    expect(requiredEnvVars({ type: "none" })).toEqual([]);
    expect(requiredEnvVars({ type: "bearer", tokenEnv: "TOK" })).toEqual(["TOK"]);
    expect(
      requiredEnvVars({ type: "basic", usernameEnv: "U", passwordEnv: "P" }),
    ).toEqual(["U", "P"]);
    expect(
      requiredEnvVars({ type: "apiKey", header: "X-Key", valueEnv: "K" }),
    ).toEqual(["K"]);
    expect(
      requiredEnvVars({ type: "customHeaders", headersEnv: { "X-A": "A", "X-B": "B" } }),
    ).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/schema.test.ts`
Expected: FAIL — cannot find module `./schema`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/loadtest/schema.ts
import { z } from "zod";

export const httpMethodSchema = z.enum([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
]);

export const requestCheckSchema = z.object({
  status: z.number().int().optional(),
  bodyContains: z.string().optional(),
});

export const requestStepSchema = z.object({
  name: z.string().min(1),
  method: httpMethodSchema.default("GET"),
  path: z.string().default("/"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  checks: requestCheckSchema.optional(),
  thinkTime: z.number().nonnegative().optional(), // seconds
});

export const authSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), tokenEnv: z.string().min(1) }),
  z.object({
    type: z.literal("basic"),
    usernameEnv: z.string().min(1),
    passwordEnv: z.string().min(1),
  }),
  z.object({
    type: z.literal("apiKey"),
    header: z.string().min(1),
    valueEnv: z.string().min(1),
  }),
  z.object({
    type: z.literal("customHeaders"),
    headersEnv: z.record(z.string(), z.string()),
  }),
]);

const stageSchema = z.object({
  target: z.number().nonnegative(),
  duration: z.string().min(1), // k6 duration, e.g. "30s", "2m"
});

export const profileSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("constant"),
    vus: z.number().int().positive(),
    duration: z.string().min(1),
  }),
  z.object({
    type: z.literal("ramping"),
    startVUs: z.number().int().nonnegative().default(0),
    stages: z.array(stageSchema).min(1),
  }),
  z.object({
    type: z.literal("constantRate"),
    rate: z.number().positive(),
    duration: z.string().min(1),
    preAllocatedVUs: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("rampingRate"),
    startRate: z.number().nonnegative().default(0),
    preAllocatedVUs: z.number().int().positive(),
    stages: z.array(stageSchema).min(1),
  }),
  // Iteration-1 goal presets:
  z.object({
    type: z.literal("baseline"),
    rate: z.number().positive().default(50),
    duration: z.string().default("1m"),
    preAllocatedVUs: z.number().int().positive().default(50),
  }),
  z.object({
    type: z.literal("breakpoint"),
    maxRate: z.number().positive().default(500),
    duration: z.string().default("2m"),
    preAllocatedVUs: z.number().int().positive().default(200),
  }),
]);

export const thresholdsSchema = z
  .object({
    p95: z.number().positive().optional(), // ms
    p99: z.number().positive().optional(), // ms
    errorRate: z.number().min(0).max(1).optional(), // fraction 0..1
    minRps: z.number().positive().optional(),
  })
  .optional();

export const loadTestConfigSchema = z.object({
  name: z.string().default("loadtest"),
  target: z.object({
    baseUrl: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  requests: z.array(requestStepSchema).min(1),
  auth: authSchema.default({ type: "none" }),
  profile: profileSchema,
  thresholds: thresholdsSchema,
});

export type LoadTestConfig = z.infer<typeof loadTestConfigSchema>;
export type RequestStep = z.infer<typeof requestStepSchema>;
export type LoadProfile = z.infer<typeof profileSchema>;
export type Auth = z.infer<typeof authSchema>;
export type Thresholds = z.infer<typeof thresholdsSchema>;

export function requiredEnvVars(auth: Auth): string[] {
  switch (auth.type) {
    case "bearer":
      return [auth.tokenEnv];
    case "basic":
      return [auth.usernameEnv, auth.passwordEnv];
    case "apiKey":
      return [auth.valueEnv];
    case "customHeaders":
      return Object.values(auth.headersEnv);
    case "none":
      return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/schema.ts src/lib/loadtest/schema.test.ts
git commit -m "feat(loadtest): config schema + requiredEnvVars"
```

---

## Task 2: localhost rewrite helper (`url.ts`)

**Files:**
- Create: `src/lib/loadtest/url.ts`
- Test: `src/lib/loadtest/url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/url.test.ts
import { describe, it, expect } from "vitest";
import { rewriteLocalhostForDocker } from "./url";

describe("rewriteLocalhostForDocker", () => {
  it("rewrites localhost to host.docker.internal", () => {
    expect(rewriteLocalhostForDocker("http://localhost:3000")).toEqual({
      url: "http://host.docker.internal:3000/",
      rewritten: true,
    });
  });

  it("rewrites 127.0.0.1", () => {
    const r = rewriteLocalhostForDocker("http://127.0.0.1:8080/api");
    expect(r.rewritten).toBe(true);
    expect(r.url).toBe("http://host.docker.internal:8080/api");
  });

  it("leaves remote hosts untouched", () => {
    expect(rewriteLocalhostForDocker("https://api.example.com")).toEqual({
      url: "https://api.example.com",
      rewritten: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/url.test.ts`
Expected: FAIL — cannot find module `./url`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/loadtest/url.ts

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/**
 * k6 runs inside a Docker container, so `localhost` would resolve to the
 * container itself, not the host. Rewrite local hostnames to the Docker
 * host gateway alias so a host-run target API is reachable.
 */
export function rewriteLocalhostForDocker(baseUrl: string): {
  url: string;
  rewritten: boolean;
} {
  const u = new URL(baseUrl);
  if (LOCAL_HOSTS.has(u.hostname)) {
    u.hostname = "host.docker.internal";
    return { url: u.toString(), rewritten: true };
  }
  return { url: baseUrl, rewritten: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/url.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/url.ts src/lib/loadtest/url.test.ts
git commit -m "feat(loadtest): localhost->host.docker.internal url rewrite"
```

---

## Task 3: k6 script generator (`script-gen.ts`)

**Files:**
- Create: `src/lib/loadtest/script-gen.ts`
- Test: `src/lib/loadtest/script-gen.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/script-gen.test.ts
import { describe, it, expect } from "vitest";
import {
  generateK6Script,
  profileToScenario,
  thresholdsToK6,
  metricKey,
} from "./script-gen";
import { loadTestConfigSchema } from "./schema";

describe("profileToScenario", () => {
  it("maps constant -> constant-vus", () => {
    expect(profileToScenario({ type: "constant", vus: 10, duration: "30s" })).toEqual({
      executor: "constant-vus",
      vus: 10,
      duration: "30s",
    });
  });

  it("maps baseline preset -> constant-arrival-rate", () => {
    expect(
      profileToScenario({ type: "baseline", rate: 50, duration: "1m", preAllocatedVUs: 50 }),
    ).toEqual({
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 50,
    });
  });

  it("maps breakpoint preset -> ramping-arrival-rate ramp to maxRate", () => {
    expect(
      profileToScenario({ type: "breakpoint", maxRate: 400, duration: "2m", preAllocatedVUs: 200 }),
    ).toEqual({
      executor: "ramping-arrival-rate",
      startRate: 0,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      stages: [{ target: 400, duration: "2m" }],
    });
  });
});

describe("thresholdsToK6", () => {
  it("maps thresholds to k6 metric expressions", () => {
    expect(thresholdsToK6({ p95: 500, errorRate: 0.01, minRps: 100 })).toEqual({
      http_req_duration: ["p(95)<500"],
      http_req_failed: ["rate<0.01"],
      http_reqs: ["rate>100"],
    });
  });

  it("returns empty object when undefined", () => {
    expect(thresholdsToK6(undefined)).toEqual({});
  });
});

describe("metricKey", () => {
  it("slugifies a request name into a metric id", () => {
    expect(metricKey("List Users!")).toBe("req_list_users_duration");
  });
});

describe("generateK6Script", () => {
  const cfg = loadTestConfigSchema.parse({
    target: { baseUrl: "http://localhost:3000", headers: { "X-Base": "1" } },
    requests: [
      {
        name: "list",
        method: "GET",
        path: "/api/items",
        checks: { status: 200, bodyContains: "items" },
        thinkTime: 1,
      },
    ],
    auth: { type: "bearer", tokenEnv: "API_TOKEN" },
    profile: { type: "constant", vus: 2, duration: "5s" },
    thresholds: { p95: 800 },
  });

  const script = generateK6Script(cfg);

  it("rewrites localhost in BASE", () => {
    expect(script).toContain('const BASE = "http://host.docker.internal:3000/"');
  });

  it("references the bearer token via __ENV (never hardcoded)", () => {
    expect(script).toContain("__ENV.API_TOKEN");
    expect(script).not.toContain("API_TOKEN=");
  });

  it("emits a per-request Trend metric", () => {
    expect(script).toContain('new Trend("req_list_duration"');
  });

  it("emits checks for status and body", () => {
    expect(script).toContain("res.status === 200");
    expect(script).toContain('res.body.includes("items")');
  });

  it("emits a handleSummary that brackets JSON with sentinels", () => {
    expect(script).toContain("export function handleSummary");
    expect(script).toContain("<<<K6_SUMMARY_START>>>");
    expect(script).toContain("<<<K6_SUMMARY_END>>>");
  });

  it("embeds the scenario and thresholds in options", () => {
    expect(script).toContain('"executor": "constant-vus"');
    expect(script).toContain('"p(95)<800"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/script-gen.test.ts`
Expected: FAIL — cannot find module `./script-gen`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/loadtest/script-gen.ts
import type { Auth, LoadProfile, LoadTestConfig, RequestStep, Thresholds } from "./schema";
import { rewriteLocalhostForDocker } from "./url";

export const SUMMARY_START = "<<<K6_SUMMARY_START>>>";
export const SUMMARY_END = "<<<K6_SUMMARY_END>>>";

export const SUMMARY_TREND_STATS = ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"];

export function metricKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `req_${slug}_duration`;
}

function trendVar(name: string): string {
  return "t_" + metricKey(name);
}

export function profileToScenario(p: LoadProfile): Record<string, unknown> {
  switch (p.type) {
    case "constant":
      return { executor: "constant-vus", vus: p.vus, duration: p.duration };
    case "ramping":
      return { executor: "ramping-vus", startVUs: p.startVUs, stages: p.stages };
    case "constantRate":
      return {
        executor: "constant-arrival-rate",
        rate: p.rate,
        timeUnit: "1s",
        duration: p.duration,
        preAllocatedVUs: p.preAllocatedVUs,
      };
    case "rampingRate":
      return {
        executor: "ramping-arrival-rate",
        startRate: p.startRate,
        timeUnit: "1s",
        preAllocatedVUs: p.preAllocatedVUs,
        stages: p.stages,
      };
    case "baseline":
      return {
        executor: "constant-arrival-rate",
        rate: p.rate,
        timeUnit: "1s",
        duration: p.duration,
        preAllocatedVUs: p.preAllocatedVUs,
      };
    case "breakpoint":
      return {
        executor: "ramping-arrival-rate",
        startRate: 0,
        timeUnit: "1s",
        preAllocatedVUs: p.preAllocatedVUs,
        stages: [{ target: p.maxRate, duration: p.duration }],
      };
  }
}

export function thresholdsToK6(t: Thresholds): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!t) return out;
  const dur: string[] = [];
  if (t.p95 != null) dur.push(`p(95)<${t.p95}`);
  if (t.p99 != null) dur.push(`p(99)<${t.p99}`);
  if (dur.length) out.http_req_duration = dur;
  if (t.errorRate != null) out.http_req_failed = [`rate<${t.errorRate}`];
  if (t.minRps != null) out.http_reqs = [`rate>${t.minRps}`];
  return out;
}

// Builds the JS object-literal string for a request's headers, merging static
// headers with auth headers. Auth values reference __ENV.* so secrets are never
// baked into the script text.
function buildHeaderExpr(headers: Record<string, string>, auth: Auth): string {
  const entries: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    entries.push(`${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  }
  switch (auth.type) {
    case "bearer":
      entries.push('"Authorization": "Bearer " + __ENV.' + auth.tokenEnv);
      break;
    case "basic":
      entries.push(
        '"Authorization": "Basic " + encoding.b64encode(__ENV.' +
          auth.usernameEnv +
          ' + ":" + __ENV.' +
          auth.passwordEnv +
          ")",
      );
      break;
    case "apiKey":
      entries.push(`${JSON.stringify(auth.header)}: __ENV.${auth.valueEnv}`);
      break;
    case "customHeaders":
      for (const [h, env] of Object.entries(auth.headersEnv)) {
        entries.push(`${JSON.stringify(h)}: __ENV.${env}`);
      }
      break;
    case "none":
      break;
  }
  return `{ ${entries.join(", ")} }`;
}

function requestStepCode(
  r: RequestStep,
  baseHeaders: Record<string, string>,
  auth: Auth,
): string {
  const headers = { ...baseHeaders, ...(r.headers ?? {}) };
  const headerExpr = buildHeaderExpr(headers, auth);
  const urlExpr = "BASE + " + JSON.stringify(r.path.replace(/^\//, ""));
  const bodyArg = r.body != null ? JSON.stringify(r.body) : "null";
  const params = `{ headers: ${headerExpr}, tags: { name: ${JSON.stringify(r.name)} } }`;

  const lines: string[] = ["  {"];
  lines.push(
    `    const res = http.request(${JSON.stringify(r.method)}, ${urlExpr}, ${bodyArg}, ${params});`,
  );
  lines.push(`    ${trendVar(r.name)}.add(res.timings.duration);`);

  const checks: string[] = [];
  if (r.checks?.status != null) {
    checks.push(`"status is ${r.checks.status}": (res) => res.status === ${r.checks.status}`);
  }
  if (r.checks?.bodyContains != null) {
    checks.push(
      `"body contains": (res) => !!res.body && String(res.body).includes(${JSON.stringify(
        r.checks.bodyContains,
      )})`,
    );
  }
  if (checks.length) {
    lines.push(`    check(res, { ${checks.join(", ")} });`);
  }
  if (r.thinkTime) {
    lines.push(`    sleep(${r.thinkTime});`);
  }
  lines.push("  }");
  return lines.join("\n");
}

export function generateK6Script(config: LoadTestConfig): string {
  const { url } = rewriteLocalhostForDocker(config.target.baseUrl);
  const options = {
    scenarios: { default: profileToScenario(config.profile) },
    thresholds: thresholdsToK6(config.thresholds),
    summaryTrendStats: SUMMARY_TREND_STATS,
  };

  const trendDecls = config.requests
    .map(
      (r) => `const ${trendVar(r.name)} = new Trend(${JSON.stringify(metricKey(r.name))}, true);`,
    )
    .join("\n");

  const baseHeaders = config.target.headers ?? {};
  const steps = config.requests
    .map((r) => requestStepCode(r, baseHeaders, config.auth))
    .join("\n\n");

  return `import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import encoding from 'k6/encoding';

export const options = ${JSON.stringify(options, null, 2)};

const BASE = ${JSON.stringify(url)};
${trendDecls}

export default function () {
${steps}
}

export function handleSummary(data) {
  return {
    stdout: ${JSON.stringify(SUMMARY_START)} + JSON.stringify(data) + ${JSON.stringify(SUMMARY_END)},
  };
}
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/script-gen.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/script-gen.ts src/lib/loadtest/script-gen.test.ts
git commit -m "feat(loadtest): pure k6 script generator"
```

---

## Task 4: results parser (`results.ts`)

**Files:**
- Create: `src/lib/loadtest/results.ts`
- Test: `src/lib/loadtest/results.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/loadtest/results.test.ts
import { describe, it, expect } from "vitest";
import { parseSummary } from "./results";
import { loadTestConfigSchema } from "./schema";

const config = loadTestConfigSchema.parse({
  name: "demo",
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "list", path: "/items" }],
  profile: { type: "constant", vus: 2, duration: "5s" },
  thresholds: { p95: 500 },
});

// Minimal k6 handleSummary `data` fixture.
const summary = {
  metrics: {
    http_req_duration: {
      thresholds: { "p(95)<500": { ok: true } },
      values: { avg: 120, min: 50, med: 110, max: 800, "p(90)": 200, "p(95)": 300, "p(99)": 700 },
    },
    http_reqs: { values: { count: 1000, rate: 200 } },
    http_req_failed: { values: { rate: 0.005, passes: 995, fails: 5 } },
    vus_max: { values: { value: 2, max: 2 } },
    data_sent: { values: { count: 5000 } },
    data_received: { values: { count: 90000 } },
    req_list_duration: {
      values: { avg: 118, min: 49, med: 109, max: 790, "p(90)": 199, "p(95)": 299, "p(99)": 690 },
    },
  },
};

describe("parseSummary", () => {
  it("extracts aggregate metrics", () => {
    const r = parseSummary(summary, config);
    expect(r.name).toBe("demo");
    expect(r.totalRequests).toBe(1000);
    expect(r.rps).toBe(200);
    expect(r.errorRate).toBe(0.005);
    expect(r.vusMax).toBe(2);
    expect(r.dataSent).toBe(5000);
    expect(r.dataReceived).toBe(90000);
    expect(r.latency).toEqual({
      avg: 120, min: 50, p50: 110, max: 800, p90: 200, p95: 300, p99: 700,
    });
  });

  it("extracts per-request latency from req_*_duration metrics", () => {
    const r = parseSummary(summary, config);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0].name).toBe("list");
    expect(r.requests[0].latency.p95).toBe(299);
  });

  it("reports thresholds passed", () => {
    const r = parseSummary(summary, config);
    expect(r.thresholds).toEqual([{ name: "http_req_duration: p(95)<500", passed: true }]);
    expect(r.passed).toBe(true);
  });

  it("marks passed=false when any threshold fails", () => {
    const failing = {
      ...summary,
      metrics: {
        ...summary.metrics,
        http_req_duration: {
          thresholds: { "p(95)<500": { ok: false } },
          values: summary.metrics.http_req_duration.values,
        },
      },
    };
    const r = parseSummary(failing, config);
    expect(r.passed).toBe(false);
  });

  it("passed=true when no thresholds are defined", () => {
    const noThresh = { metrics: { ...summary.metrics, http_req_duration: { values: summary.metrics.http_req_duration.values } } };
    const r = parseSummary(noThresh, config);
    expect(r.thresholds).toEqual([]);
    expect(r.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/results.test.ts`
Expected: FAIL — cannot find module `./results`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/loadtest/results.ts
import type { LoadTestConfig } from "./schema";
import { metricKey } from "./script-gen";

export interface LatencyStats {
  avg: number;
  min: number;
  p50: number;
  max: number;
  p90: number;
  p95: number;
  p99: number;
}

export interface ThresholdResult {
  name: string;
  passed: boolean;
}

export interface RequestStat {
  name: string;
  latency: Partial<LatencyStats>;
}

export interface LoadTestResult {
  name: string;
  passed: boolean;
  latency: LatencyStats;
  totalRequests: number;
  rps: number;
  errorRate: number;
  vusMax: number;
  dataSent: number;
  dataReceived: number;
  requests: RequestStat[];
  thresholds: ThresholdResult[];
}

interface K6Metric {
  values?: Record<string, number>;
  thresholds?: Record<string, { ok: boolean }>;
}
interface K6Summary {
  metrics?: Record<string, K6Metric>;
}

function num(v: number | undefined): number {
  return typeof v === "number" ? v : 0;
}

function latencyOf(values: Record<string, number> | undefined): LatencyStats {
  const v = values ?? {};
  return {
    avg: num(v.avg),
    min: num(v.min),
    p50: num(v.med),
    max: num(v.max),
    p90: num(v["p(90)"]),
    p95: num(v["p(95)"]),
    p99: num(v["p(99)"]),
  };
}

export function parseSummary(summary: unknown, config: LoadTestConfig): LoadTestResult {
  const s = (summary ?? {}) as K6Summary;
  const m = s.metrics ?? {};

  const thresholds: ThresholdResult[] = [];
  for (const [metricName, metric] of Object.entries(m)) {
    if (!metric.thresholds) continue;
    for (const [expr, res] of Object.entries(metric.thresholds)) {
      thresholds.push({ name: `${metricName}: ${expr}`, passed: res.ok });
    }
  }

  const requests: RequestStat[] = config.requests.map((r) => ({
    name: r.name,
    latency: latencyOf(m[metricKey(r.name)]?.values),
  }));

  return {
    name: config.name,
    passed: thresholds.every((t) => t.passed),
    latency: latencyOf(m.http_req_duration?.values),
    totalRequests: num(m.http_reqs?.values?.count),
    rps: num(m.http_reqs?.values?.rate),
    errorRate: num(m.http_req_failed?.values?.rate),
    vusMax: num(m.vus_max?.values?.max ?? m.vus_max?.values?.value),
    dataSent: num(m.data_sent?.values?.count),
    dataReceived: num(m.data_received?.values?.count),
    requests,
    thresholds,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/loadtest/results.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/results.ts src/lib/loadtest/results.test.ts
git commit -m "feat(loadtest): k6 summary -> LoadTestResult parser"
```

---

## Task 5: Executor interface + orchestrator (`executor.ts`, `run-load-test.ts`, `index.ts`)

**Files:**
- Create: `src/lib/loadtest/executor.ts`
- Create: `src/lib/loadtest/run-load-test.ts`
- Create: `src/lib/loadtest/index.ts`
- Test: `src/lib/loadtest/run-load-test.test.ts`

- [ ] **Step 1: Write the executor interface (no test — pure types)**

```ts
// src/lib/loadtest/executor.ts

export interface Progress {
  /** One line of k6 stderr (live progress / logs). */
  line: string;
}

export interface RunOpts {
  /** Secret env vars passed to the k6 container (referenced as __ENV.*). */
  env: Record<string, string>;
  signal?: AbortSignal;
}

export interface RawRunOutput {
  /** Parsed k6 handleSummary `data` object. */
  summary: unknown;
  /** Container exit code. 0 = pass, 99 = thresholds failed (NOT an error). */
  exitCode: number;
}

export interface Executor {
  run(
    script: string,
    opts: RunOpts,
    onProgress: (p: Progress) => void,
  ): Promise<RawRunOutput>;
}
```

- [ ] **Step 2: Write the failing orchestrator test**

```ts
// src/lib/loadtest/run-load-test.test.ts
import { describe, it, expect } from "vitest";
import { runLoadTest } from "./run-load-test";
import type { Executor, RawRunOutput } from "./executor";

const fakeSummary = {
  metrics: {
    http_req_duration: {
      thresholds: { "p(95)<500": { ok: true } },
      values: { avg: 100, min: 10, med: 90, max: 400, "p(90)": 150, "p(95)": 200, "p(99)": 350 },
    },
    http_reqs: { values: { count: 500, rate: 100 } },
    http_req_failed: { values: { rate: 0 } },
    vus_max: { values: { max: 5 } },
    data_sent: { values: { count: 1 } },
    data_received: { values: { count: 2 } },
    req_home_duration: { values: { "p(95)": 199 } },
  },
};

function fakeExecutor(captured: { script?: string; env?: Record<string, string> }): Executor {
  return {
    async run(script, opts): Promise<RawRunOutput> {
      captured.script = script;
      captured.env = opts.env;
      return { summary: fakeSummary, exitCode: 0 };
    },
  };
}

const baseConfig = {
  name: "demo",
  target: { baseUrl: "https://api.example.com" },
  requests: [{ name: "home", path: "/" }],
  profile: { type: "constant", vus: 2, duration: "5s" },
  thresholds: { p95: 500 },
};

describe("runLoadTest", () => {
  it("validates, generates script, runs the executor, and parses the result", async () => {
    const captured: { script?: string; env?: Record<string, string> } = {};
    const result = await runLoadTest(baseConfig, { executor: fakeExecutor(captured) });
    expect(captured.script).toContain("export const options");
    expect(result.name).toBe("demo");
    expect(result.passed).toBe(true);
    expect(result.rps).toBe(100);
  });

  it("resolves auth env vars and passes them to the executor", async () => {
    const captured: { script?: string; env?: Record<string, string> } = {};
    await runLoadTest(
      { ...baseConfig, auth: { type: "bearer", tokenEnv: "API_TOKEN" } },
      { executor: fakeExecutor(captured), env: { API_TOKEN: "secret123" } },
    );
    expect(captured.env).toEqual({ API_TOKEN: "secret123" });
  });

  it("throws a clear error when a required auth env var is missing", async () => {
    const captured: { script?: string; env?: Record<string, string> } = {};
    await expect(
      runLoadTest(
        { ...baseConfig, auth: { type: "bearer", tokenEnv: "API_TOKEN" } },
        { executor: fakeExecutor(captured), env: {} },
      ),
    ).rejects.toThrow(/API_TOKEN/);
  });

  it("throws on invalid config", async () => {
    await expect(
      runLoadTest({ target: { baseUrl: "nope" }, requests: [], profile: {} }, {
        executor: fakeExecutor({}),
      }),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/loadtest/run-load-test.test.ts`
Expected: FAIL — cannot find module `./run-load-test`.

- [ ] **Step 4: Write the orchestrator**

```ts
// src/lib/loadtest/run-load-test.ts
import { formatError } from "@/lib/errors";
import type { Executor, Progress } from "./executor";
import { K6DockerExecutor } from "./executors/k6-docker";
import { parseSummary, type LoadTestResult } from "./results";
import { generateK6Script } from "./script-gen";
import { loadTestConfigSchema, requiredEnvVars } from "./schema";

export interface RunOptions {
  /** Override the execution backend (defaults to K6DockerExecutor). */
  executor?: Executor;
  /** Live progress callback (one k6 stderr line at a time). */
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
  /** Source of secret env vars (defaults to process.env). */
  env?: Record<string, string | undefined>;
}

export async function runLoadTest(
  input: unknown,
  opts: RunOptions = {},
): Promise<LoadTestResult> {
  const config = loadTestConfigSchema.parse(input);
  const script = generateK6Script(config);

  const env = opts.env ?? process.env;
  const secrets: Record<string, string> = {};
  for (const name of requiredEnvVars(config.auth)) {
    const value = env[name];
    if (value == null || value === "") {
      throw new Error(`Missing required environment variable for auth: ${name}`);
    }
    secrets[name] = value;
  }

  const executor = opts.executor ?? new K6DockerExecutor();
  try {
    const output = await executor.run(
      script,
      { env: secrets, signal: opts.signal },
      opts.onProgress ?? (() => {}),
    );
    return parseSummary(output.summary, config);
  } catch (err) {
    throw new Error(formatError(err));
  }
}
```

- [ ] **Step 5: Write the barrel export**

```ts
// src/lib/loadtest/index.ts
export { runLoadTest, type RunOptions } from "./run-load-test";
export { loadTestConfigSchema, type LoadTestConfig } from "./schema";
export type { LoadTestResult, LatencyStats, ThresholdResult, RequestStat } from "./results";
export type { Executor, Progress, RunOpts, RawRunOutput } from "./executor";
export { K6DockerExecutor } from "./executors/k6-docker";
```

> **Note:** `index.ts` imports `K6DockerExecutor` (created in Task 6). Implement Task 6 before running typecheck/build, but the orchestrator unit test in this task only uses the fake executor and passes independently.

- [ ] **Step 6: Run the orchestrator test to verify it passes**

Run: `npx vitest run src/lib/loadtest/run-load-test.test.ts`
Expected: PASS (4 tests). (Vitest resolves the static import of `./executors/k6-docker` lazily enough that the fake-executor tests pass; if module resolution errors because the file is absent, proceed to Task 6 first, then re-run — the test logic is correct.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/loadtest/executor.ts src/lib/loadtest/run-load-test.ts src/lib/loadtest/index.ts src/lib/loadtest/run-load-test.test.ts
git commit -m "feat(loadtest): Executor interface + runLoadTest orchestrator"
```

---

## Task 6: k6 Docker executor (`executors/k6-docker.ts`)

**Files:**
- Create: `src/lib/loadtest/executors/k6-docker.ts`
- Create: `src/lib/loadtest/executors/k6-docker.integration.test.ts`

> This executor talks to a real Docker daemon, so it follows the repo convention: it is covered by an **integration test** gated on `BAKLAVA_INTEGRATION=1` (the unit suite never spawns Docker). The orchestrator's unit tests (Task 5) already cover the surrounding logic via a fake executor.

- [ ] **Step 1: Write the implementation**

```ts
// src/lib/loadtest/executors/k6-docker.ts
import type { Writable } from "node:stream";
import { PassThrough } from "node:stream";
import { createDockerClient } from "@/lib/connections/docker";
import type { DockerConfig } from "@/lib/connections/types";
import type { Executor, Progress, RawRunOutput, RunOpts } from "../executor";
import { SUMMARY_END, SUMMARY_START } from "../script-gen";

const K6_IMAGE = "grafana/k6:latest";
const PASS_EXIT = 0;
const THRESHOLD_FAIL_EXIT = 99;

async function ensureImage(client: ReturnType<typeof createDockerClient>): Promise<void> {
  try {
    await client.getImage(K6_IMAGE).inspect();
    return; // already present
  } catch {
    // not present — pull it
  }
  await new Promise<void>((resolve, reject) => {
    client.pull(K6_IMAGE, (err: Error | null, stream?: NodeJS.ReadableStream) => {
      if (err || !stream) {
        reject(err || new Error("no pull stream"));
        return;
      }
      client.modem.followProgress(
        stream,
        (e: Error | null) => (e ? reject(e) : resolve()),
        () => undefined,
      );
    });
  });
}

function extractSummary(stdout: string): unknown {
  const start = stdout.indexOf(SUMMARY_START);
  const end = stdout.indexOf(SUMMARY_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("k6 produced no parseable summary (did the run start?)");
  }
  const json = stdout.slice(start + SUMMARY_START.length, end);
  return JSON.parse(json);
}

export class K6DockerExecutor implements Executor {
  constructor(
    private dockerConfig: DockerConfig = { mode: "socket", socketPath: "/var/run/docker.sock" },
  ) {}

  async run(
    script: string,
    opts: RunOpts,
    onProgress: (p: Progress) => void,
  ): Promise<RawRunOutput> {
    const client = createDockerClient(this.dockerConfig);
    await ensureImage(client);

    const envArr = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);

    const container = await client.createContainer({
      Image: K6_IMAGE,
      Cmd: ["run", "--quiet", "-"], // read script from stdin
      Env: envArr,
      OpenStdin: true,
      StdinOnce: true,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      HostConfig: {
        ExtraHosts: ["host.docker.internal:host-gateway"],
      },
    });

    let stdout = "";
    const outStream = new PassThrough();
    const errStream = new PassThrough();
    outStream.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    errStream.on("data", (c: Buffer) => {
      for (const line of c.toString("utf8").split("\n")) {
        if (line.trim()) onProgress({ line: line.trimEnd() });
      }
    });

    const stream = await container.attach({
      stream: true,
      hijack: true,
      stdin: true,
      stdout: true,
      stderr: true,
    });
    container.modem.demuxStream(stream, outStream as Writable, errStream as Writable);

    const onAbort = () => {
      void container.remove({ force: true }).catch(() => undefined);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      await container.start();
      // Feed the generated script via stdin, then signal EOF.
      stream.write(script);
      stream.end();

      const status = await container.wait();
      const exitCode = status.StatusCode as number;

      if (exitCode !== PASS_EXIT && exitCode !== THRESHOLD_FAIL_EXIT) {
        throw new Error(`k6 exited with code ${exitCode}`);
      }
      const summary = extractSummary(stdout);
      return { summary, exitCode };
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
      await container.remove({ force: true }).catch(() => undefined);
    }
  }
}
```

- [ ] **Step 2: Write the integration test**

```ts
// src/lib/loadtest/executors/k6-docker.integration.test.ts
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runLoadTest } from "../run-load-test";

// Gated by vitest config: only runs when BAKLAVA_INTEGRATION=1 (needs Docker).
describe("K6DockerExecutor (integration)", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: [1, 2, 3] }));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("runs k6 against a local server and returns structured results", async () => {
    const result = await runLoadTest({
      name: "integration",
      target: { baseUrl: `http://localhost:${port}` },
      requests: [{ name: "list", path: "/", checks: { status: 200, bodyContains: "items" } }],
      profile: { type: "constant", vus: 2, duration: "3s" },
      thresholds: { p95: 2000, errorRate: 0.1 },
    });

    expect(result.totalRequests).toBeGreaterThan(0);
    expect(result.requests[0].name).toBe("list");
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 3: Verify the unit suite still passes (executor not exercised without Docker)**

Run: `npx vitest run src/lib/loadtest`
Expected: PASS for all non-integration tests; the integration test is skipped (empty include) without `BAKLAVA_INTEGRATION=1`.

- [ ] **Step 4: (Optional, requires Docker) Run the integration test**

Run: `BAKLAVA_INTEGRATION=1 npx vitest run --project=integration src/lib/loadtest/executors/k6-docker.integration.test.ts`
Expected: PASS — pulls `grafana/k6` on first run (may take ~30s), then runs a 3s test and asserts results. If Docker is unavailable, this is expected to error on connection; that's acceptable for environments without Docker.

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadtest/executors/k6-docker.ts src/lib/loadtest/executors/k6-docker.integration.test.ts
git commit -m "feat(loadtest): k6 Docker executor via dockerode (stdin script, stdout summary)"
```

---

## Task 7: CLI adapter (`scripts/loadtest.ts`)

**Files:**
- Create: `scripts/loadtest.ts`
- Create: `examples/loadtest/httpbin.json`
- Modify: `package.json` (add `tsx` devDependency + `loadtest` script)

- [ ] **Step 1: Add the `tsx` runner and npm script**

Run:
```bash
npm install --save-dev tsx
```

Then add to `package.json` `"scripts"` (alongside the existing entries):
```json
    "loadtest": "tsx scripts/loadtest.ts"
```

- [ ] **Step 2: Write an example config**

```json
{
  "name": "httpbin-baseline",
  "target": { "baseUrl": "https://httpbin.org" },
  "requests": [
    { "name": "get", "method": "GET", "path": "/get", "checks": { "status": 200 } }
  ],
  "profile": { "type": "baseline", "rate": 5, "duration": "10s", "preAllocatedVUs": 5 },
  "thresholds": { "p95": 2000, "errorRate": 0.05 }
}
```

Save as `examples/loadtest/httpbin.json`.

- [ ] **Step 3: Write the CLI**

```ts
// scripts/loadtest.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runLoadTest } from "@/lib/loadtest";

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: npm run loadtest -- <config.json>");
    process.exit(2);
  }

  const raw = readFileSync(resolve(process.cwd(), file), "utf8");
  const config = JSON.parse(raw);

  console.error(`\n▶ Running load test: ${config.name ?? "loadtest"}\n`);

  const result = await runLoadTest(config, {
    onProgress: ({ line }) => process.stderr.write(`  ${line}\n`),
  });

  console.log("\n──────── Results ────────");
  console.log(`Requests:   ${result.totalRequests}  (${result.rps.toFixed(1)} req/s)`);
  console.log(`Errors:     ${(result.errorRate * 100).toFixed(2)}%`);
  console.log(`Latency:    p50 ${result.latency.p50}ms  p95 ${result.latency.p95}ms  p99 ${result.latency.p99}ms  max ${result.latency.max}ms`);
  console.log(`Max VUs:    ${result.vusMax}`);
  console.log(`Data:       ↑ ${fmtBytes(result.dataSent)}  ↓ ${fmtBytes(result.dataReceived)}`);

  if (result.requests.length > 1) {
    console.log("\nPer request (p95):");
    for (const r of result.requests) {
      console.log(`  ${r.name}: ${r.latency.p95 ?? "-"}ms`);
    }
  }

  if (result.thresholds.length) {
    console.log("\nThresholds:");
    for (const t of result.thresholds) {
      console.log(`  ${t.passed ? "✓" : "✗"} ${t.name}`);
    }
  }

  console.log(`\n${result.passed ? "✓ PASSED" : "✗ FAILED"}\n`);
  process.exit(result.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
```

> **Note on `@/` in scripts:** `tsx` resolves the `@/*` → `src/*` alias from `tsconfig.json` `compilerOptions.paths`. Confirm `tsconfig.json` maps `"@/*": ["./src/*"]` (it does in this repo, since app code uses `@/`). If `tsx` does not pick it up, change the import to a relative path `../src/lib/loadtest/index.ts`.

- [ ] **Step 4: Verify the CLI runs (requires Docker + network)**

Run: `npm run loadtest -- examples/loadtest/httpbin.json`
Expected: progress lines stream to stderr, then a Results block; exits 0 if thresholds pass. If Docker is unavailable, expect a clear error message and exit 1 — acceptable when Docker isn't present.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/loadtest.ts examples/loadtest/httpbin.json
git commit -m "feat(loadtest): CLI adapter (tsx) + example config"
```

---

## Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test`
Expected: PASS, including all `src/lib/loadtest/*.test.ts` (integration tests skipped without `BAKLAVA_INTEGRATION=1`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Production build**

Run: `npm run build`
Expected: build succeeds. (The loadtest module is server-only library code; it must not break the Next build. `dockerode` is already in `serverExternalPackages`.)

- [ ] **Step 5: Commit any incidental fixes, then finish the branch**

```bash
git status
# If verification surfaced fixes, commit them:
# git add -A && git commit -m "fix(loadtest): verification fixes"
```

Then use the `superpowers:finishing-a-development-branch` skill to decide how to integrate (merge / PR).

---

## Self-Review Notes

- **Spec coverage:** schema (target/requests/auth/profiles/thresholds) → Task 1; localhost rewrite → Task 2; script-gen incl. profile→executor mapping, presets, per-request metrics, env-ref secrets, handleSummary → Task 3; results parser incl. threshold pass/fail and threshold-breach-is-not-an-error contract → Task 4 + executor exit-code handling Task 6; Executor interface + orchestrator w/ progress + DI → Task 5; k6 Docker executor incl. image pull, ExtraHosts, abort/cleanup → Task 6; CLI w/ non-zero-on-failure → Task 7; unit + integration testing → all tasks + Task 8.
- **Deviation from spec:** summary returned over stdout (handleSummary markers) instead of a bind-mounted file — documented in the header note; simpler and meets the spec's intent.
- **Type consistency:** `metricKey` defined once in `script-gen.ts` and reused by `results.ts`; `LoadTestResult`/`LatencyStats` field names (`p50/p90/p95/p99`) consistent across parser, orchestrator, and CLI; `Executor`/`RunOpts`/`RawRunOutput` consistent across `executor.ts`, `run-load-test.ts`, `k6-docker.ts`.
- **Out of scope (deferred, per spec):** Baklava UI workspace + SSE route, CI gating workflow, alternative executors, non-HTTP protocols.
