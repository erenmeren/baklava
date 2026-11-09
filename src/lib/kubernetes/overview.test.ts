import { describe, expect, it } from "vitest";
import { buildOverview, type PodLike } from "./overview";

const now = new Date("2026-01-01T12:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

function pod(name: string, phase: string, extra: Partial<PodLike["status"]> = {}, created = minsAgo(1)): PodLike {
  return { metadata: { name, namespace: "demo", creationTimestamp: created }, status: { phase, ...extra } };
}

describe("buildOverview", () => {
  it("counts pods by phase", () => {
    const o = buildOverview(
      { pods: [pod("a", "Running"), pod("b", "Running"), pod("c", "Pending"), pod("d", "Succeeded"), pod("e", "Failed"), pod("f", "")] },
      now,
    );
    expect(o.pods).toEqual({ total: 6, Running: 2, Pending: 1, Failed: 1, Succeeded: 1, Unknown: 1 });
  });

  it("flags crash loops, image pulls, errors, restarts and stuck Pending", () => {
    const o = buildOverview(
      {
        pods: [
          pod("crash", "Running", { containerStatuses: [{ state: { waiting: { reason: "CrashLoopBackOff" } } }] }),
          pod("img", "Pending", { containerStatuses: [{ state: { waiting: { reason: "ErrImagePull", message: "not found" } } }] }),
          pod("err", "Failed"),
          pod("flaky", "Running", { containerStatuses: [{ restartCount: 3 }, { restartCount: 2 }] }),
          pod("stuck", "Pending", {}, minsAgo(6)),
          pod("starting", "Pending", {}, minsAgo(2)),
          pod("ok", "Running", { containerStatuses: [{ restartCount: 4 }] }),
        ],
      },
      now,
    );
    expect(o.attention.map((a) => [a.name, a.reason])).toEqual([
      ["crash", "CrashLoopBackOff"],
      ["img", "ImagePullBackOff"],
      ["err", "Error"],
      ["flaky", "Restarting"],
      ["stuck", "Pending"],
    ]);
    expect(o.attention[1].detail).toBe("not found");
  });

  it("flags NotReady nodes and pressure conditions; counts ready", () => {
    const o = buildOverview({
      nodes: [
        { metadata: { name: "n1" }, status: { conditions: [{ type: "Ready", status: "True" }] } },
        { metadata: { name: "n2" }, status: { conditions: [{ type: "Ready", status: "False" }, { type: "DiskPressure", status: "True" }] } },
      ],
    });
    expect(o.nodes).toEqual({ total: 2, ready: 1 });
    expect(o.attention.map((a) => `${a.name}:${a.reason}`)).toEqual(["n2:NotReady", "n2:DiskPressure"]);
  });

  it("flags deployments with unavailable replicas", () => {
    const o = buildOverview({
      deployments: [
        { metadata: { name: "web", namespace: "demo" }, spec: { replicas: 3 }, status: { availableReplicas: 1, unavailableReplicas: 2 } },
        { metadata: { name: "api", namespace: "demo" }, spec: { replicas: 1 }, status: { availableReplicas: 1 } },
      ],
    });
    expect(o.deployments).toEqual({ total: 2, unavailable: 1 });
    expect(o.attention).toEqual([
      { kind: "Deployment", namespace: "demo", name: "web", reason: "Unavailable", detail: "1/3 available" },
    ]);
  });

  it("keeps Warning events only, newest first, capped at 20", () => {
    const events = Array.from({ length: 25 }, (_, i) => ({
      type: "Warning",
      reason: `R${i}`,
      lastTimestamp: minsAgo(i),
      involvedObject: { kind: "Pod", name: `p${i}` },
    }));
    const o = buildOverview({ events: [{ type: "Normal", reason: "Pulled", lastTimestamp: minsAgo(0) }, ...events.reverse()] }, now);
    expect(o.warnings).toHaveLength(20);
    expect(o.warnings![0]).toMatchObject({ reason: "R0", object: "Pod/p0", ageSeconds: 0 });
    expect(o.warnings![19].reason).toBe("R19");
  });

  it("sums node usage against allocatable; null without metrics-server", () => {
    const nodes = [
      { status: { allocatable: { cpu: "2", memory: "4Gi" } } },
      { status: { allocatable: { cpu: "1500m", memory: "1Gi" } } },
    ];
    const o = buildOverview({
      nodes,
      nodeUsage: [{ usage: { cpu: "250000000n", memory: "1Gi" } }, { usage: { cpu: "250m", memory: "512Mi" } }],
    });
    expect(o.usage).toEqual({
      cpuMillicores: 500,
      cpuAllocatable: 3500,
      memBytes: 1.5 * 1024 ** 3,
      memAllocatable: 5 * 1024 ** 3,
    });
    expect(buildOverview({ nodes }).usage).toBeNull();
  });

  it("missing sections stay null rather than zero", () => {
    const o = buildOverview({});
    expect(o).toEqual({ pods: null, nodes: null, deployments: null, attention: [], warnings: null, usage: null });
  });
});
