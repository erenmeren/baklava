import { describe, it, expect } from "vitest";
import { runToCsv, runToJson, exportFilename } from "./run-export";
import type { LoadTestRun } from "./store";
import type { LoadTestResult } from "./results";

const result: LoadTestResult = {
  name: "demo",
  passed: true,
  latency: { avg: 120, min: 50, p50: 110, max: 800, p90: 200, p95: 300, p99: 700 },
  totalRequests: 1000,
  rps: 200,
  errorRate: 0.005,
  vusMax: 2,
  dataSent: 5000,
  dataReceived: 90000,
  requests: [{ name: "list", latency: { avg: 118, min: 49, p50: 109, max: 790, p90: 199, p95: 299, p99: 690 } }],
  thresholds: [{ name: "http_req_duration: p(95)<500", passed: true }],
};

const run: LoadTestRun = {
  id: "run123",
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_030_000,
  status: "passed",
  result,
};

describe("runToCsv", () => {
  it("includes summary metrics and a per-request section", () => {
    const csv = runToCsv(run);
    expect(csv).toContain("metric,value");
    expect(csv).toContain("total_requests,1000");
    expect(csv).toContain("latency_p95_ms,300");
    expect(csv).toContain("request,avg_ms,p50_ms,p90_ms,p95_ms,p99_ms,max_ms");
    expect(csv).toContain("list,118,109,199,299,690,790");
    expect(csv).toContain("threshold,passed");
  });

  it("handles a run with no result", () => {
    const csv = runToCsv({ id: "x", startedAt: 0, status: "error", error: "boom" });
    expect(csv).toContain("status,error");
    expect(csv).not.toContain("total_requests");
  });
});

describe("runToJson", () => {
  it("embeds the run and is valid JSON", () => {
    const parsed = JSON.parse(runToJson("My Test", run));
    expect(parsed.test).toBe("My Test");
    expect(parsed.run.id).toBe("run123");
    expect(parsed.run.result.rps).toBe(200);
  });
});

describe("exportFilename", () => {
  it("slugifies the test name", () => {
    expect(exportFilename("My API / Load Test!", "abc")).toBe("my-api-load-test-abc");
  });
  it("falls back when the name has no usable chars", () => {
    expect(exportFilename("!!!", "abc")).toBe("loadtest-abc");
  });
});
