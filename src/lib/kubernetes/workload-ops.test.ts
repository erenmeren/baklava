import { describe, it, expect } from "vitest";
import {
  INSTANTIATE_ANNOTATION,
  POD_COLOR_COUNT,
  jobFromCronJob,
  parseWorkloadKind,
  podColor,
  selectorToString,
} from "./workload-ops";

describe("selectorToString", () => {
  it("renders matchLabels and every matchExpressions operator", () => {
    expect(
      selectorToString({
        matchLabels: { app: "api", tier: "web" },
        matchExpressions: [
          { key: "env", operator: "In", values: ["prod", "stage"] },
          { key: "canary", operator: "NotIn", values: ["true"] },
          { key: "team", operator: "Exists" },
          { key: "legacy", operator: "DoesNotExist" },
        ],
      }),
    ).toBe("app=api,tier=web,env in (prod,stage),canary notin (true),team,!legacy");
  });

  it("refuses an empty selector — it would match every pod in the namespace", () => {
    expect(() => selectorToString({})).toThrow(/empty/);
    expect(() => selectorToString(undefined)).toThrow(/empty/);
  });
});

describe("parseWorkloadKind", () => {
  it("accepts the three workload kinds only", () => {
    expect(parseWorkloadKind("statefulset")).toBe("statefulset");
    expect(() => parseWorkloadKind("pod")).toThrow();
    expect(() => parseWorkloadKind("toString")).toThrow();
  });
});

describe("podColor", () => {
  it("is stable and in range", () => {
    expect(podColor("api-7d9f-abcde")).toBe(podColor("api-7d9f-abcde"));
    for (const n of ["a", "api-0", "api-1", "x".repeat(300)]) {
      const c = podColor(n);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(POD_COLOR_COUNT);
    }
  });
});

describe("jobFromCronJob", () => {
  const cj = {
    metadata: { name: "nightly-report", namespace: "demo", uid: "cj-1" },
    spec: {
      jobTemplate: {
        metadata: { labels: { team: "data" } },
        spec: { template: { spec: { restartPolicy: "Never" } } },
      },
    },
  };

  it("builds a manual Job owned by the CronJob, like kubectl create job --from", () => {
    const job = jobFromCronJob(cj, "a1b2c3");
    expect(job.metadata.name).toBe("nightly-report-manual-a1b2c3");
    expect(job.metadata.namespace).toBe("demo");
    expect(job.metadata.labels).toEqual({ team: "data" });
    expect(job.metadata.annotations[INSTANTIATE_ANNOTATION]).toBe("manual");
    expect(job.metadata.ownerReferences[0]).toMatchObject({ kind: "CronJob", uid: "cj-1", controller: true });
    expect(job.spec).toBe(cj.spec.jobTemplate.spec);
  });

  it("keeps the name within 63 chars without cutting the suffix", () => {
    const long = { ...cj, metadata: { ...cj.metadata, name: "n".repeat(70) } };
    const name = jobFromCronJob(long, "a1b2c3").metadata.name;
    expect(name.length).toBe(63);
    expect(name.endsWith("-manual-a1b2c3")).toBe(true);
  });
});
