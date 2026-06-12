import { describe, it, expect } from "vitest";
import {
  generateK6Script,
  profileToScenario,
  thresholdsToK6,
  metricKey,
} from "./script-gen";
import { loadTestConfigSchema } from "./schema";

describe("profileToScenario", () => {
  it("maps constant -> constant-vus", () => {
    expect(profileToScenario({ type: "constant", vus: 10, duration: "30s" })).toEqual({
      executor: "constant-vus",
      vus: 10,
      duration: "30s",
    });
  });

  it("maps baseline preset -> constant-arrival-rate", () => {
    expect(
      profileToScenario({ type: "baseline", rate: 50, duration: "1m", preAllocatedVUs: 50 }),
    ).toEqual({
      executor: "constant-arrival-rate",
      rate: 50,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 50,
    });
  });

  it("maps breakpoint preset -> ramping-arrival-rate ramp to maxRate", () => {
    expect(
      profileToScenario({ type: "breakpoint", maxRate: 400, duration: "2m", preAllocatedVUs: 200 }),
    ).toEqual({
      executor: "ramping-arrival-rate",
      startRate: 0,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      stages: [{ target: 400, duration: "2m" }],
    });
  });

  it("maps ramping -> ramping-vus", () => {
    expect(
      profileToScenario({ type: "ramping", startVUs: 0, stages: [{ target: 20, duration: "30s" }] }),
    ).toEqual({
      executor: "ramping-vus",
      startVUs: 0,
      stages: [{ target: 20, duration: "30s" }],
    });
  });

  it("maps constantRate -> constant-arrival-rate", () => {
    expect(
      profileToScenario({ type: "constantRate", rate: 100, duration: "1m", preAllocatedVUs: 50 }),
    ).toEqual({
      executor: "constant-arrival-rate",
      rate: 100,
      timeUnit: "1s",
      duration: "1m",
      preAllocatedVUs: 50,
    });
  });

  it("maps rampingRate -> ramping-arrival-rate", () => {
    expect(
      profileToScenario({
        type: "rampingRate",
        startRate: 0,
        preAllocatedVUs: 100,
        stages: [{ target: 200, duration: "2m" }],
      }),
    ).toEqual({
      executor: "ramping-arrival-rate",
      startRate: 0,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      stages: [{ target: 200, duration: "2m" }],
    });
  });
});

describe("thresholdsToK6", () => {
  it("maps thresholds to k6 metric expressions", () => {
    expect(thresholdsToK6({ p95: 500, errorRate: 0.01, minRps: 100 })).toEqual({
      http_req_duration: ["p(95)<500"],
      http_req_failed: ["rate<0.01"],
      http_reqs: ["rate>100"],
    });
  });

  it("returns empty object when undefined", () => {
    expect(thresholdsToK6(undefined)).toEqual({});
  });
});

describe("metricKey", () => {
  it("slugifies a request name into a metric id", () => {
    expect(metricKey("List Users!")).toBe("req_list_users_duration");
  });
});

describe("generateK6Script", () => {
  const cfg = loadTestConfigSchema.parse({
    target: { baseUrl: "http://localhost:3000", headers: { "X-Base": "1" } },
    requests: [
      {
        name: "list",
        method: "GET",
        path: "/api/items",
        checks: { status: 200, bodyContains: "items" },
        thinkTime: 1,
      },
    ],
    auth: { type: "bearer", tokenEnv: "API_TOKEN" },
    profile: { type: "constant", vus: 2, duration: "5s" },
    thresholds: { p95: 800 },
  });

  const script = generateK6Script(cfg);

  it("rewrites localhost in BASE", () => {
    expect(script).toContain('const BASE = "http://host.docker.internal:3000"');
  });

  it("references the bearer token via __ENV (never hardcoded)", () => {
    expect(script).toContain('__ENV["API_TOKEN"]');
    expect(script).not.toContain("API_TOKEN=");
  });

  it("emits a per-request Trend metric", () => {
    expect(script).toContain('new Trend("req_list_duration"');
  });

  it("emits checks for status and body", () => {
    expect(script).toContain("res.status === 200");
    expect(script).toContain('res.body.includes("items")');
  });

  it("emits a handleSummary that brackets JSON with sentinels", () => {
    expect(script).toContain("export function handleSummary");
    expect(script).toContain("<<<K6_SUMMARY_START>>>");
    expect(script).toContain("<<<K6_SUMMARY_END>>>");
  });

  it("embeds the scenario and thresholds in options", () => {
    expect(script).toContain('"executor": "constant-vus"');
    expect(script).toContain('"p(95)<800"');
  });

  it("joins remote base + path with exactly one slash", () => {
    const remote = loadTestConfigSchema.parse({
      target: { baseUrl: "https://api.example.com" },
      requests: [{ name: "get", method: "GET", path: "/get" }],
      profile: { type: "constant", vus: 1, duration: "1s" },
    });
    const s = generateK6Script(remote);
    expect(s).toContain('const BASE = "https://api.example.com"');
    expect(s).toContain('BASE + "/get"');
    expect(s).not.toContain("api.example.comget");
  });

  it("normalizes a path missing its leading slash", () => {
    const cfg2 = loadTestConfigSchema.parse({
      target: { baseUrl: "https://api.example.com" },
      requests: [{ name: "x", method: "GET", path: "items" }],
      profile: { type: "constant", vus: 1, duration: "1s" },
    });
    expect(generateK6Script(cfg2)).toContain('BASE + "/items"');
  });
});

describe("generateK6Script auth + multi-request", () => {
  it("emits basic auth via encoding.b64encode with __ENV bracket refs", () => {
    const cfg = loadTestConfigSchema.parse({
      target: { baseUrl: "https://x.test" },
      requests: [{ name: "a", path: "/a" }],
      auth: { type: "basic", usernameEnv: "U", passwordEnv: "P" },
      profile: { type: "constant", vus: 1, duration: "1s" },
    });
    const s = generateK6Script(cfg);
    expect(s).toContain('encoding.b64encode(__ENV["U"]');
    expect(s).toContain('__ENV["P"]');
  });

  it("emits apiKey header via __ENV bracket ref", () => {
    const cfg = loadTestConfigSchema.parse({
      target: { baseUrl: "https://x.test" },
      requests: [{ name: "a", path: "/a" }],
      auth: { type: "apiKey", header: "X-Api-Key", valueEnv: "K" },
      profile: { type: "constant", vus: 1, duration: "1s" },
    });
    const s = generateK6Script(cfg);
    expect(s).toContain('"X-Api-Key": __ENV["K"]');
  });

  it("emits customHeaders via __ENV bracket refs", () => {
    const cfg = loadTestConfigSchema.parse({
      target: { baseUrl: "https://x.test" },
      requests: [{ name: "a", path: "/a" }],
      auth: { type: "customHeaders", headersEnv: { "X-A": "AA", "X-B": "BB" } },
      profile: { type: "constant", vus: 1, duration: "1s" },
    });
    const s = generateK6Script(cfg);
    expect(s).toContain('"X-A": __ENV["AA"]');
    expect(s).toContain('"X-B": __ENV["BB"]');
  });

  it("emits a POST body argument", () => {
    const cfg = loadTestConfigSchema.parse({
      target: { baseUrl: "https://x.test" },
      requests: [{ name: "create", method: "POST", path: "/items", body: '{"a":1}' }],
      profile: { type: "constant", vus: 1, duration: "1s" },
    });
    const s = generateK6Script(cfg);
    expect(s).toContain('http.request("POST"');
    expect(s).toContain('{\\\"a\\\":1}');
  });

  it("emits a Trend and request block per request for multi-request configs", () => {
    const cfg = loadTestConfigSchema.parse({
      target: { baseUrl: "https://x.test" },
      requests: [
        { name: "list", path: "/list" },
        { name: "create", method: "POST", path: "/create", body: "x" },
      ],
      profile: { type: "constant", vus: 1, duration: "1s" },
    });
    const s = generateK6Script(cfg);
    expect(s).toContain("req_list_duration");
    expect(s).toContain("req_create_duration");
    expect(s).toContain('BASE + "/list"');
    expect(s).toContain('BASE + "/create"');
  });
});
