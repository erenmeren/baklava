import { describe, it, expect } from "vitest";
import {
  RESTART_ANNOTATION,
  parseReplicas,
  withReplicas,
  withRestartedAt,
} from "./deployment-ops";

describe("parseReplicas", () => {
  it("accepts a non-negative integer", () => {
    expect(parseReplicas(0)).toBe(0);
    expect(parseReplicas(7)).toBe(7);
  });

  it("accepts a numeric string, the shape a JSON body often carries", () => {
    expect(parseReplicas("3")).toBe(3);
  });

  it("rejects a negative count", () => {
    expect(() => parseReplicas(-1)).toThrow(/replicas/i);
  });

  it("rejects a fractional count", () => {
    expect(() => parseReplicas(1.5)).toThrow(/replicas/i);
  });

  it("rejects anything that isn't a number", () => {
    expect(() => parseReplicas("many")).toThrow(/replicas/i);
    expect(() => parseReplicas(undefined)).toThrow(/replicas/i);
    expect(() => parseReplicas(null)).toThrow(/replicas/i);
  });
});

describe("withReplicas", () => {
  it("sets spec.replicas without disturbing the rest of the manifest", () => {
    const deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: "api", namespace: "payments" },
      spec: { replicas: 2, selector: { matchLabels: { app: "api" } } },
    };

    const next = withReplicas(deployment, 5);

    expect(next.spec?.replicas).toBe(5);
    expect(next.spec?.selector).toEqual({ matchLabels: { app: "api" } });
    expect(next.metadata).toEqual({ name: "api", namespace: "payments" });
  });

  it("scales to zero", () => {
    expect(withReplicas({ spec: { replicas: 3 } }, 0).spec?.replicas).toBe(0);
  });

  it("does not mutate the object it was given", () => {
    const deployment = { spec: { replicas: 2 } };
    withReplicas(deployment, 9);
    expect(deployment.spec.replicas).toBe(2);
  });

  it("creates spec when the manifest somehow has none", () => {
    expect(withReplicas({ metadata: { name: "api" } }, 1).spec?.replicas).toBe(1);
  });
});

describe("withRestartedAt", () => {
  const stamp = "2026-08-18T05:00:00.000Z";

  it("stamps the pod template annotation kubectl uses for a rollout restart", () => {
    const next = withRestartedAt(
      { spec: { template: { metadata: { labels: { app: "api" } } } } },
      stamp,
    );

    const meta = next.spec?.template?.metadata;
    expect(meta?.annotations?.[RESTART_ANNOTATION]).toBe(stamp);
    // The annotation goes on the *template*, not the Deployment itself — that
    // is what makes the ReplicaSet roll.
    expect(meta?.labels).toEqual({ app: "api" });
  });

  it("overwrites a previous restart stamp", () => {
    const next = withRestartedAt(
      {
        spec: {
          template: {
            metadata: { annotations: { [RESTART_ANNOTATION]: "2020-01-01T00:00:00.000Z" } },
          },
        },
      },
      stamp,
    );
    expect(next.spec?.template?.metadata?.annotations?.[RESTART_ANNOTATION]).toBe(stamp);
  });

  it("keeps other annotations", () => {
    const next = withRestartedAt(
      { spec: { template: { metadata: { annotations: { "prometheus.io/scrape": "true" } } } } },
      stamp,
    );
    expect(next.spec?.template?.metadata?.annotations?.["prometheus.io/scrape"]).toBe("true");
  });

  it("does not mutate the object it was given", () => {
    const deployment = { spec: { template: { metadata: { annotations: {} } } } };
    withRestartedAt(deployment, stamp);
    expect(deployment.spec.template.metadata.annotations).toEqual({});
  });

  it("builds the template path when the manifest has none", () => {
    expect(
      withRestartedAt({}, stamp).spec?.template?.metadata?.annotations?.[RESTART_ANNOTATION],
    ).toBe(stamp);
  });
});
