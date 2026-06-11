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
      entries.push('"Authorization": "Bearer " + __ENV[' + JSON.stringify(auth.tokenEnv) + "]");
      break;
    case "basic":
      entries.push(
        '"Authorization": "Basic " + encoding.b64encode(__ENV[' +
          JSON.stringify(auth.usernameEnv) +
          '] + ":" + __ENV[' +
          JSON.stringify(auth.passwordEnv) +
          "])",
      );
      break;
    case "apiKey":
      entries.push(`${JSON.stringify(auth.header)}: __ENV[${JSON.stringify(auth.valueEnv)}]`);
      break;
    case "customHeaders":
      for (const [h, env] of Object.entries(auth.headersEnv)) {
        entries.push(`${JSON.stringify(h)}: __ENV[${JSON.stringify(env)}]`);
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
      `"body contains": (res) => !!res.body && res.body.includes(${JSON.stringify(
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
