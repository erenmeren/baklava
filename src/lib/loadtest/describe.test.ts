import { describe, it, expect } from "vitest";
import { describeAuth, describeProfile, describeThresholds, profileLabel } from "./describe";
import type { LoadProfile } from "./schema";
import type { SavedAuth } from "./store-schema";

describe("describeProfile", () => {
  it("describes constant load", () => {
    const p: LoadProfile = { type: "constant", vus: 10, duration: "30s" };
    expect(profileLabel(p)).toBe("Constant load");
    expect(describeProfile(p)).toBe("10 VUs for 30s");
  });

  it("describes ramping VUs with stages", () => {
    const p: LoadProfile = { type: "ramping", startVUs: 0, stages: [{ target: 50, duration: "1m" }, { target: 0, duration: "30s" }] };
    expect(describeProfile(p)).toBe("start 0 VUs → 50 VUs @ 1m → 0 VUs @ 30s");
  });

  it("describes constant arrival rate", () => {
    const p: LoadProfile = { type: "constantRate", rate: 50, duration: "2m", preAllocatedVUs: 100 };
    expect(describeProfile(p)).toBe("50 req/s for 2m (≤100 VUs)");
  });
});

describe("describeAuth", () => {
  it("never leaks secret values", () => {
    const cases: SavedAuth[] = [
      { type: "none" },
      { type: "bearer", token: "super-secret-token" },
      { type: "basic", username: "alice", password: "hunter2" },
      { type: "apiKey", header: "X-Api-Key", value: "secretvalue" },
      { type: "customHeaders", headers: { "X-Token": "secretvalue" } },
    ];
    const described = cases.map(describeAuth).join(" | ");
    expect(described).not.toContain("super-secret-token");
    expect(described).not.toContain("hunter2");
    expect(described).not.toContain("secretvalue");
    expect(described).toContain("Bearer token");
    expect(described).toContain("user: alice");
    expect(described).toContain("X-Api-Key");
  });
});

describe("describeThresholds", () => {
  it("returns empty for undefined", () => {
    expect(describeThresholds(undefined)).toEqual([]);
  });
  it("formats each configured threshold", () => {
    expect(describeThresholds({ p95: 500, errorRate: 0.01, minRps: 100 })).toEqual([
      "p95 < 500ms",
      "error rate < 1.00%",
      "throughput ≥ 100 req/s",
    ]);
  });
});
