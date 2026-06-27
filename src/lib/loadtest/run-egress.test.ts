import { describe, it, expect } from "vitest";
import { runLoadTest } from "./run-load-test";

const cfg = {
  name: "ssrf",
  target: { baseUrl: "http://169.254.169.254/latest/meta-data" },
  requests: [{ name: "r", method: "GET", path: "/" }],
  auth: { type: "none" },
  profile: { type: "constant", vus: 1, duration: "1s" },
  thresholds: undefined,
};

describe("loadtest egress", () => {
  it("refuses a metadata-IP target before running k6", async () => {
    await expect(runLoadTest(cfg)).rejects.toThrow(/blocked|metadata/i);
  });
});
