import os from "node:os";
import path from "node:path";
import { readSecretFileSync, writeSecretFileSync } from "@/lib/crypto/secret-file";
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
  /** Owner of this load test. Load tests are personal: only the owner may
   *  list/read/run/update/delete them (admins do NOT cross-browse). Empty
   *  string ("") marks an ownerless legacy row (persisted before per-user
   *  scoping existed) — those are fail-closed invisible to everyone, since no
   *  real viewer id is ever "". */
  ownerId: string;
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

// Cap on retained runs per test. Generous so history is effectively unlimited
// for normal use, while keeping ~/.baklava/loadtests.json from growing without
// bound. Oldest runs are trimmed first (see appendRun).
const MAX_RUNS = 500;

function getDataDir() {
  return process.env.BAKLAVA_DATA_DIR || path.join(os.homedir(), ".baklava");
}
function getFile() {
  return path.join(getDataDir(), "loadtests.json");
}

interface PersistedShape {
  version: 1;
  loadtests: LoadTest[];
}

function loadFromDisk(): LoadTest[] {
  try {
    const raw = readSecretFileSync(getFile());
    if (raw == null) return [];
    const data = JSON.parse(raw) as Partial<PersistedShape>;
    if (!Array.isArray(data?.loadtests)) {
      console.warn(`[baklava] ${getFile()} has unexpected shape, ignoring (starting empty)`);
      return [];
    }
    for (const t of data.loadtests) {
      // Legacy rows (pre per-user scoping) have no ownerId. Normalise to "" so
      // the strict-ownership filter treats them as ownerless → invisible to
      // every real user (fail closed; never leak another user's load test).
      if (typeof t.ownerId !== "string") t.ownerId = "";
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
    console.warn(`[baklava] could not read ${getFile()}:`, err);
    return [];
  }
}

function persistToDisk(records: LoadTest[]): void {
  try {
    const payload: PersistedShape = { version: 1, loadtests: records };
    writeSecretFileSync(getFile(), JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error(`[baklava] could not persist ${getFile()}:`, err);
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

// All accessors below are viewer-scoped. Load tests are personal: a viewer only
// ever sees / mutates tests they own. A non-owner (or an empty viewer id from an
// unauthenticated request, or a legacy ownerless row) is treated exactly as if
// the test did not exist — the routes turn that into a 404 to avoid an existence
// oracle. Fail closed: an empty viewer id never matches anything.

/** Internal: resolve a test only if `viewerUserId` owns it. */
function ownedTest(id: string, viewerUserId: string): LoadTest | undefined {
  if (!viewerUserId) return undefined;
  const test = getStore().byId.get(id);
  if (!test || test.ownerId !== viewerUserId) return undefined;
  return test;
}

/** Does `viewerUserId` own load test `id`? Fail closed: empty id never matches. */
export function ownsLoadTest(id: string, viewerUserId: string): boolean {
  return ownedTest(id, viewerUserId) !== undefined;
}

export function listLoadTests(viewerUserId: string): LoadTest[] {
  if (!viewerUserId) return [];
  return [...getStore().byId.values()].filter((t) => t.ownerId === viewerUserId);
}

export function getLoadTest(id: string, viewerUserId: string): LoadTest | undefined {
  return ownedTest(id, viewerUserId);
}

export function saveLoadTest(
  ownerId: string,
  input: { name: string; config: SavedLoadTestConfig },
): LoadTest {
  const now = Date.now();
  const record: LoadTest = {
    id: genId(),
    ownerId,
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
  viewerUserId: string,
  patch: { name?: string; config?: SavedLoadTestConfig },
): LoadTest | undefined {
  const existing = ownedTest(id, viewerUserId);
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

export function deleteLoadTest(id: string, viewerUserId: string): boolean {
  if (!ownedTest(id, viewerUserId)) return false;
  const deleted = getStore().byId.delete(id);
  if (deleted) flush();
  return deleted;
}

export function appendRun(
  testId: string,
  viewerUserId: string,
  input: { startedAt: number; status: RunStatus },
): LoadTestRun {
  const test = ownedTest(testId, viewerUserId);
  if (!test) throw new Error(`load test not found: ${testId}`);
  const run: LoadTestRun = { id: genId(), startedAt: input.startedAt, status: input.status };
  test.runs.push(run);
  if (test.runs.length > MAX_RUNS) test.runs.splice(0, test.runs.length - MAX_RUNS);
  flush();
  return { ...run };
}

export function updateRun(
  testId: string,
  viewerUserId: string,
  runId: string,
  patch: Partial<Pick<LoadTestRun, "status" | "finishedAt" | "result" | "error">>,
): LoadTestRun | undefined {
  const test = ownedTest(testId, viewerUserId);
  if (!test) return undefined;
  const run = test.runs.find((r) => r.id === runId);
  if (!run) return undefined;
  Object.assign(run, patch);
  flush();
  return { ...run };
}

export function listRuns(testId: string, viewerUserId: string): LoadTestRun[] {
  const test = ownedTest(testId, viewerUserId);
  if (!test) return [];
  return [...test.runs].reverse();
}

export function getRun(
  testId: string,
  viewerUserId: string,
  runId: string,
): LoadTestRun | undefined {
  return ownedTest(testId, viewerUserId)?.runs.find((r) => r.id === runId);
}
