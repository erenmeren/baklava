import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResultDashboard } from "./result-dashboard";
import type { LoadTestResult } from "@/lib/loadtest/results";

const RESULT: LoadTestResult = {
  name: "demo",
  passed: false,
  latency: { avg: 100, min: 10, p50: 90, max: 400, p90: 150, p95: 220, p99: 350 },
  totalRequests: 1234,
  rps: 205.5,
  errorRate: 0.012,
  vusMax: 10,
  dataSent: 5000,
  dataReceived: 90000,
  requests: [{ name: "list", latency: { avg: 100, min: 10, p50: 90, max: 400, p90: 150, p95: 219, p99: 350 } }],
  thresholds: [
    { name: "http_req_duration: p(95)<200", passed: false },
    { name: "http_req_failed: rate<0.01", passed: false },
  ],
};

describe("ResultDashboard", () => {
  it("renders headline metrics", () => {
    render(<ResultDashboard result={RESULT} />);
    expect(screen.getByText("1234")).toBeInTheDocument();
    expect(screen.getByText("205.5")).toBeInTheDocument();
    expect(screen.getByText("220ms")).toBeInTheDocument();
    expect(screen.getByText("1.20%")).toBeInTheDocument();
  });

  it("renders per-request rows and thresholds", () => {
    render(<ResultDashboard result={RESULT} />);
    expect(screen.getByText("list")).toBeInTheDocument();
    expect(screen.getByText("http_req_duration: p(95)<200")).toBeInTheDocument();
  });
});
