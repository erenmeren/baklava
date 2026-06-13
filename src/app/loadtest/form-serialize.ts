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

export function validateFormState(s: FormState): string | null {
  if (!s.name.trim()) return "Test name is required.";
  if (!s.target.baseUrl.trim()) return "Base URL is required.";
  if (s.requests.some((r) => !r.name.trim())) return "Every request needs a name.";
  const numOk = (v: string) => v.trim() !== "" && !Number.isNaN(Number(v));
  const p = s.profile;
  const reqNums: string[] =
    p.type === "constant" ? [p.vus]
    : p.type === "baseline" || p.type === "constantRate" ? [p.rate, p.preAllocatedVUs]
    : p.type === "breakpoint" ? [p.maxRate, p.preAllocatedVUs]
    : p.type === "ramping" ? [p.startVUs, ...p.stages.map((x) => x.target)]
    : [p.startRate, p.preAllocatedVUs, ...p.stages.map((x) => x.target)];
  if (reqNums.some((n) => !numOk(n))) return "All profile numeric fields must be valid numbers.";
  const durs: string[] =
    p.type === "constant" || p.type === "baseline" || p.type === "constantRate" || p.type === "breakpoint" ? [p.duration]
    : p.stages.map((x) => x.duration);
  if (durs.some((d) => !d.trim())) return "All durations are required.";
  return null;
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
