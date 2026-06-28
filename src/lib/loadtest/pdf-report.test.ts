import { describe, it, expect } from "vitest";
import { renderRunPdf } from "./pdf-report";
import type { LoadTest, LoadTestRun } from "./store";

const test: LoadTest = {
  id: "t1",
  ownerId: "user-1",
  name: "Checkout API",
  createdAt: 0,
  updatedAt: 0,
  config: {
    target: { baseUrl: "https://api.example.com" },
    requests: [
      { name: "list", method: "GET", path: "/items" },
      { name: "create", method: "POST", path: "/items" },
    ],
    auth: { type: "bearer", token: "super-secret" },
    profile: { type: "constant", vus: 10, duration: "30s" },
    thresholds: { p95: 500, errorRate: 0.01 },
  },
  runs: [],
};

const run: LoadTestRun = {
  id: "run1",
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_030_000,
  status: "passed",
  result: {
    name: "Checkout API",
    passed: true,
    latency: { avg: 120, min: 50, p50: 110, max: 800, p90: 200, p95: 300, p99: 700 },
    totalRequests: 1000,
    rps: 200,
    errorRate: 0.005,
    vusMax: 10,
    dataSent: 5000,
    dataReceived: 90000,
    requests: [
      { name: "list", latency: { avg: 118, min: 49, p50: 109, max: 790, p90: 199, p95: 299, p99: 690 } },
      { name: "create", latency: { avg: 220, min: 80, p50: 210, max: 900, p90: 400, p95: 480, p99: 880 } },
    ],
    thresholds: [
      { name: "http_req_duration: p(95)<500", passed: true },
      { name: "http_req_failed: rate<0.01", passed: true },
    ],
  },
};

describe("renderRunPdf", () => {
  it("produces a valid, non-trivial PDF without leaking secrets", async () => {
    const pdf = await renderRunPdf(test, run);
    expect(pdf.length).toBeGreaterThan(1000);
    // PDF magic header
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    // the bearer token must never appear in the bytes
    expect(pdf.toString("latin1")).not.toContain("super-secret");
  });

  it("renders an error run", async () => {
    const errRun: LoadTestRun = { id: "r2", startedAt: 0, finishedAt: 1000, status: "error", error: "k6 container exited 1" };
    const pdf = await renderRunPdf(test, errRun);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
