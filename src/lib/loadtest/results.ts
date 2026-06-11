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
  latency: LatencyStats;
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
