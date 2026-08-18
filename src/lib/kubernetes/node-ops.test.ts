import { describe, it, expect } from "vitest";
import { evictablePods, withUnschedulable } from "./node-ops";

describe("withUnschedulable", () => {
  it("cordons by setting spec.unschedulable", () => {
    const node = { metadata: { name: "worker-1" }, spec: {} };
    expect(withUnschedulable(node, true).spec?.unschedulable).toBe(true);
  });

  it("uncordons by clearing it", () => {
    const node = { metadata: { name: "worker-1" }, spec: { unschedulable: true } };
    expect(withUnschedulable(node, false).spec?.unschedulable).toBe(false);
  });

  it("keeps the rest of the spec", () => {
    const node = { metadata: { name: "w" }, spec: { podCIDR: "10.0.0.0/24" } };
    expect(withUnschedulable(node, true).spec?.podCIDR).toBe("10.0.0.0/24");
  });

  it("does not mutate its input", () => {
    const node = { metadata: { name: "w" }, spec: { unschedulable: false } };
    withUnschedulable(node, true);
    expect(node.spec.unschedulable).toBe(false);
  });

  it("builds spec when the node has none", () => {
    expect(withUnschedulable({ metadata: { name: "w" } }, true).spec?.unschedulable).toBe(true);
  });
});

describe("evictablePods", () => {
  // The metadata overrides merge into metadata — spreading them at the top
  // level would replace it and drop the name, which would make the skip tests
  // pass for the wrong reason.
  const on = (node: string, name: string, meta: Record<string, unknown> = {}) => ({
    metadata: { name, namespace: "default", ...meta },
    spec: { nodeName: node },
  });

  it("takes the pods scheduled on that node", () => {
    const pods = [on("worker-1", "a"), on("worker-2", "b"), on("worker-1", "c")];
    expect(evictablePods(pods, "worker-1").map((p) => p.name)).toEqual(["a", "c"]);
  });

  it("skips mirror pods — the kubelet owns them and eviction cannot remove them", () => {
    const mirror = on("worker-1", "kube-apiserver", {
      annotations: { "kubernetes.io/config.mirror": "abc" },
    });
    expect(evictablePods([mirror, on("worker-1", "a")], "worker-1").map((p) => p.name)).toEqual([
      "a",
    ]);
  });

  it("skips DaemonSet pods, which would be recreated on the same node immediately", () => {
    const ds = on("worker-1", "fluentbit", {
      ownerReferences: [{ kind: "DaemonSet", name: "fluentbit" }],
    });
    expect(evictablePods([ds, on("worker-1", "a")], "worker-1").map((p) => p.name)).toEqual(["a"]);
  });

  it("keeps pods owned by anything else", () => {
    const rs = on("worker-1", "api-0", {
      ownerReferences: [{ kind: "ReplicaSet", name: "api" }],
    });
    expect(evictablePods([rs], "worker-1").map((p) => p.name)).toEqual(["api-0"]);
  });

  it("skips pods that are already terminating", () => {
    const dying = on("worker-1", "a", {
      deletionTimestamp: "2026-08-18T11:00:00.000Z",
    });
    expect(evictablePods([dying], "worker-1")).toEqual([]);
  });

  it("carries the namespace, which eviction needs", () => {
    expect(evictablePods([on("worker-1", "a")], "worker-1")[0]).toEqual({
      name: "a",
      namespace: "default",
    });
  });
});
