// Pure string builders for exporting a single load-test run as JSON or CSV.
// Client-safe (no node imports). The browser download is handled by
// downloadText() from src/lib/sql/result-export.ts.
import type { LoadTestRun } from "./store";
import type { SavedLoadTestConfig } from "./store-schema";
import { describeAuth, describeProfile, describeThresholds, profileLabel } from "./describe";

/**
 * A self-contained JSON export: the run, plus a description of the (redacted)
 * config it ran against when one is supplied.
 */
export function runToJson(testName: string, run: LoadTestRun, config?: SavedLoadTestConfig): string {
  return JSON.stringify(
    {
      test: testName,
      target: config?.target.baseUrl,
      profile: config && { kind: profileLabel(config.profile), summary: describeProfile(config.profile) },
      auth: config && describeAuth(config.auth),
      thresholds: config && describeThresholds(config.thresholds),
      run,
    },
    null,
    2,
  );
}

function csvCell(s: string | number | undefined): string {
  const v = s == null ? "" : String(s);
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Flat CSV with two sections: top-level summary metrics, then a per-request
 * latency breakdown — the shape that pastes cleanly into a spreadsheet.
 */
export function runToCsv(run: LoadTestRun): string {
  const lines: string[] = [];
  const r = run.result;

  lines.push("metric,value");
  lines.push(`status,${csvCell(run.status)}`);
  if (r) {
    lines.push(`passed,${csvCell(String(r.passed))}`);
    lines.push(`total_requests,${csvCell(r.totalRequests)}`);
    lines.push(`rps,${csvCell(r.rps)}`);
    lines.push(`error_rate,${csvCell(r.errorRate)}`);
    lines.push(`max_vus,${csvCell(r.vusMax)}`);
    lines.push(`latency_avg_ms,${csvCell(r.latency.avg)}`);
    lines.push(`latency_p50_ms,${csvCell(r.latency.p50)}`);
    lines.push(`latency_p90_ms,${csvCell(r.latency.p90)}`);
    lines.push(`latency_p95_ms,${csvCell(r.latency.p95)}`);
    lines.push(`latency_p99_ms,${csvCell(r.latency.p99)}`);
    lines.push(`latency_max_ms,${csvCell(r.latency.max)}`);
    lines.push(`data_sent_bytes,${csvCell(r.dataSent)}`);
    lines.push(`data_received_bytes,${csvCell(r.dataReceived)}`);
  }

  if (r?.requests.length) {
    lines.push("");
    lines.push("request,avg_ms,p50_ms,p90_ms,p95_ms,p99_ms,max_ms");
    for (const req of r.requests) {
      const l = req.latency;
      lines.push(
        [req.name, l.avg, l.p50, l.p90, l.p95, l.p99, l.max].map(csvCell).join(","),
      );
    }
  }

  if (r?.thresholds.length) {
    lines.push("");
    lines.push("threshold,passed");
    for (const t of r.thresholds) lines.push(`${csvCell(t.name)},${csvCell(String(t.passed))}`);
  }

  return lines.join("\n");
}

/** Safe filename stem from a test name + run id (no extension). */
export function exportFilename(testName: string, runId: string): string {
  const slug = testName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "loadtest";
  return `${slug}-${runId}`;
}
