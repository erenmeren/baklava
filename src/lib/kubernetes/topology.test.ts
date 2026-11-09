import { describe, expect, it } from "vitest";
import { buildTopology, nodeRole, type TopoNodeLike, type TopoPodLike } from "./topology";

const now = new Date("2026-01-01T12:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

function node(name: string, labels: Record<string, string> = {}, ready = "True"): TopoNodeLike {
  return {
    metadata: { name, labels },
    status: { conditions: [{ type: "Ready", status: ready }], allocatable: { cpu: "2", memory: "4Gi" } },
  };
}

function pod(
  name: string,
  nodeName: string | undefined,
  owner?: { kind: string; name: string },
  status: TopoPodLike["status"] = { phase: "Running" },
  created = minsAgo(1),
): TopoPodLike {
  return {
    metadata: {
      name,
      namespace: "demo",
      creationTimestamp: created,
      ownerReferences: owner ? [{ ...owner, controller: true }] : undefined,
    },
    spec: { nodeName },
    status,
  };
}

const rs = (name: string, deployment: string) => ({
  metadata: { name, namespace: "demo", ownerReferences: [{ kind: "Deployment", name: deployment, controller: true }] },
});

describe("nodeRole", () => {
  it("reads control-plane and the legacy master label, else worker", () => {
    expect(nodeRole(node("a", { "node-role.kubernetes.io/control-plane": "true" }))).toBe("control-plane");
    expect(nodeRole(node("b", { "node-role.kubernetes.io/master": "" }))).toBe("control-plane");
    expect(nodeRole(node("c", { "kubernetes.io/os": "linux" }))).toBe("worker");
  });
});

describe("buildTopology", () => {
  it("resolves Pod → ReplicaSet → Deployment and groups replicas per node", () => {
    const t = buildTopology(
      {
        nodes: [node("w1"), node("w2")],
        replicaSets: [rs("web-abc", "web")],
        pods: [
          pod("web-abc-1", "w1", { kind: "ReplicaSet", name: "web-abc" }),
          pod("web-abc-2", "w1", { kind: "ReplicaSet", name: "web-abc" }),
          pod("web-abc-3", "w2", { kind: "ReplicaSet", name: "web-abc" }),
          pod("db-0", "w2", { kind: "StatefulSet", name: "db" }),
          pod("agent-x", "w2", { kind: "DaemonSet", name: "agent" }),
          pod("loner", "w2"),
        ],
      },
      now,
    );
    const w1 = t.nodes.find((n) => n.name === "w1")!;
    expect(w1.workloads).toHaveLength(1);
    expect(w1.workloads[0]).toMatchObject({ kind: "Deployment", namespace: "demo", name: "web", replicas: 2 });
    const w2 = t.nodes.find((n) => n.name === "w2")!;
    expect(w2.workloads.map((w) => [w.kind, w.name, w.replicas])).toEqual([
      ["DaemonSet", "agent", 1],
      ["StatefulSet", "db", 1],
      ["Pod", "loner", 1],
      ["Deployment", "web", 1],
    ]);
    expect(t.summary).toMatchObject({ nodes: 2, controlPlane: 0, workers: 2, pods: 6 });
  });

  it("keeps the ReplicaSet as owner when the RS isn't known", () => {
    const t = buildTopology({ nodes: [node("w1")], pods: [pod("x-1", "w1", { kind: "ReplicaSet", name: "x-abc" })] }, now);
    expect(t.nodes[0].workloads[0]).toMatchObject({ kind: "ReplicaSet", name: "x-abc" });
  });

  it("flags problem pods and sorts problem workloads first", () => {
    const t = buildTopology(
      {
        nodes: [node("w1")],
        pods: [
          pod("a-ok", "w1", { kind: "Job", name: "a" }),
          pod("z-bad", "w1", undefined, {
            phase: "Pending",
            containerStatuses: [{ state: { waiting: { reason: "ImagePullBackOff" } } }],
          }),
        ],
      },
      now,
    );
    const [first, second] = t.nodes[0].workloads;
    expect(first).toMatchObject({ name: "z-bad", problem: true });
    expect(first.pods[0].problem).toBe("ImagePullBackOff");
    expect(second).toMatchObject({ name: "a", problem: false });
  });

  it("puts node-less pods in unscheduled, flagging only long-Pending ones", () => {
    const t = buildTopology(
      {
        nodes: [node("w1")],
        pods: [
          pod("stuck", undefined, undefined, { phase: "Pending" }, minsAgo(6)),
          pod("fresh", undefined, undefined, { phase: "Pending" }, minsAgo(1)),
        ],
      },
      now,
    );
    expect(t.nodes[0].podCount).toBe(0);
    expect(t.unscheduled.map((w) => [w.name, w.problem])).toEqual([
      ["stuck", true],
      ["fresh", false],
    ]);
    expect(t.summary.pods).toBe(2);
  });

  it("skips Succeeded pods", () => {
    const t = buildTopology({ nodes: [node("w1")], pods: [pod("done", "w1", undefined, { phase: "Succeeded" })] }, now);
    expect(t.nodes[0].podCount).toBe(0);
  });

  it("computes usage per node and cluster-wide from metrics", () => {
    const t = buildTopology(
      {
        nodes: [node("cp", { "node-role.kubernetes.io/control-plane": "true" }), node("w1")],
        pods: [pod("p", "w1"), pod("q", "w1")],
        nodeUsage: [
          { metadata: { name: "cp" }, usage: { cpu: "500m", memory: "1Gi" } },
          { metadata: { name: "w1" }, usage: { cpu: "1500m", memory: "3Gi" } },
        ],
        podUsage: [
          { metadata: { name: "p", namespace: "demo" }, containers: [{ usage: { cpu: "10m", memory: "10Mi" } }, { usage: { cpu: "20m", memory: "6Mi" } }] },
          { metadata: { name: "q", namespace: "demo" }, containers: [{ usage: { cpu: "50m", memory: "32Mi" } }] },
        ],
      },
      now,
    );
    const w1 = t.nodes.find((n) => n.name === "w1")!;
    expect(w1.cpu).toEqual({ used: 1500, allocatable: 2000, pct: 75 });
    expect(w1.mem?.pct).toBe(75);
    // Two bare pods → two groups of one, each with its own usage.
    expect(w1.workloads.map((w) => [w.name, w.cpuPerPod, w.memPerPod])).toEqual([
      ["p", 30, 16 * 1024 ** 2],
      ["q", 50, 32 * 1024 ** 2],
    ]);
    expect(t.summary).toMatchObject({ controlPlane: 1, workers: 1, cpuPct: 50, memPct: 50 });
  });

  it("leaves usage null when metrics-server is missing", () => {
    const t = buildTopology({ nodes: [node("w1")], pods: [pod("p", "w1")] }, now);
    expect(t.nodes[0].cpu).toBeNull();
    expect(t.nodes[0].mem).toBeNull();
    expect(t.nodes[0].workloads[0].cpuPerPod).toBeNull();
    expect(t.summary.cpuPct).toBeNull();
    expect(t.summary.memPct).toBeNull();
  });

  it("builds nodes from pods when the node list is unavailable", () => {
    const t = buildTopology({ pods: [pod("p", "hidden-node")] }, now);
    expect(t.nodes).toEqual([
      expect.objectContaining({ name: "hidden-node", role: "unknown", ready: null, podCount: 1 }),
    ]);
    expect(t.summary).toMatchObject({ nodes: 1, controlPlane: 0, workers: 0 });
  });
});
