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

  it("does not throw on null/undefined/empty summary and returns zeroed stats", () => {
    for (const input of [null, undefined, {}]) {
      const r = parseSummary(input, config);
      expect(r.name).toBe("demo");
      expect(r.totalRequests).toBe(0);
      expect(r.rps).toBe(0);
      expect(r.errorRate).toBe(0);
      expect(r.latency).toEqual({ avg: 0, min: 0, p50: 0, max: 0, p90: 0, p95: 0, p99: 0 });
      expect(r.passed).toBe(true); // no thresholds present -> passed
    }
  });

  it("zeroes per-request latency when the request metric is absent", () => {
    const r = parseSummary({ metrics: {} }, config);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0].name).toBe("list");
    expect(r.requests[0].latency).toEqual({ avg: 0, min: 0, p50: 0, max: 0, p90: 0, p95: 0, p99: 0 });
  });
});
