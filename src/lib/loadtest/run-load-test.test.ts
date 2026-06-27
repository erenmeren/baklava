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
  target: { baseUrl: "http://127.0.0.1:8080" },
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
