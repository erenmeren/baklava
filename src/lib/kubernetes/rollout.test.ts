import { describe, it, expect } from "vitest";
import {
  parseRevision,
  rolloutHistory,
  rolloutStatus,
  undoPatch,
  type ReplicaSetLike,
} from "./rollout";

const DEPLOY = {
  metadata: { uid: "d-1", annotations: { "deployment.kubernetes.io/revision": "3" } },
};

function rs(name: string, revision: string, image: string, owner = "d-1"): ReplicaSetLike {
  return {
    metadata: {
      name,
      annotations: {
        "deployment.kubernetes.io/revision": revision,
        "kubernetes.io/change-cause": `set ${image}`,
      },
      ownerReferences: [{ uid: owner, kind: "Deployment", controller: true }],
    },
    spec: {
      template: {
        metadata: { labels: { app: "api", "pod-template-hash": `h${revision}` } },
        spec: { containers: [{ name: "web", image }] },
      },
    },
    status: { replicas: revision === "3" ? 2 : 0 },
  };
}

const SETS = [rs("api-a", "1", "nginx:1.25"), rs("api-c", "3", "nginx:1.27"), rs("api-b", "2", "nginx:1.26"), rs("other", "9", "x", "d-2")];

describe("rolloutHistory", () => {
  it("keeps only owned ReplicaSets, newest revision first, current flagged", () => {
    const h = rolloutHistory(DEPLOY, SETS);
    expect(h.map((r) => r.revision)).toEqual([3, 2, 1]);
    expect(h[0]).toMatchObject({ current: true, images: ["nginx:1.27"], changeCause: "set nginx:1.27", replicas: 2 });
    expect(h.filter((r) => r.current)).toHaveLength(1);
  });

  it("drops ReplicaSets without a revision annotation", () => {
    const bare: ReplicaSetLike = { metadata: { name: "x", ownerReferences: [{ uid: "d-1" }] } };
    expect(rolloutHistory(DEPLOY, [bare])).toEqual([]);
  });
});

describe("undoPatch", () => {
  it("replaces the whole template with the target's, minus pod-template-hash", () => {
    const [op] = undoPatch(SETS, DEPLOY, 1);
    expect(op).toEqual({
      op: "replace",
      path: "/spec/template",
      value: { metadata: { labels: { app: "api" } }, spec: { containers: [{ name: "web", image: "nginx:1.25" }] } },
    });
    // the source ReplicaSet is not mutated
    expect(SETS[0].spec?.template?.metadata?.labels?.["pod-template-hash"]).toBe("h1");
  });

  it("refuses an unknown or already-running revision", () => {
    expect(() => undoPatch(SETS, DEPLOY, 7)).toThrow(/not found/);
    expect(() => undoPatch(SETS, DEPLOY, 3)).toThrow(/already running/);
    // another deployment's ReplicaSet is never a rollback target
    expect(() => undoPatch(SETS, DEPLOY, 9)).toThrow(/not found/);
  });
});

describe("rolloutStatus", () => {
  it("reports a finished rollout as complete", () => {
    const s = rolloutStatus({
      metadata: { generation: 4 },
      spec: { replicas: 2 },
      status: {
        observedGeneration: 4,
        replicas: 2,
        updatedReplicas: 2,
        readyReplicas: 2,
        availableReplicas: 2,
        conditions: [{ type: "Progressing", status: "True", reason: "NewReplicaSetAvailable", message: "ok" }],
      },
    });
    expect(s).toMatchObject({ desired: 2, updated: 2, complete: true, paused: false });
    expect(s.progressing?.reason).toBe("NewReplicaSetAvailable");
  });

  it("is not complete while old replicas linger or the spec is unobserved", () => {
    const base = { spec: { replicas: 2 }, status: { replicas: 3, updatedReplicas: 2, availableReplicas: 2 } };
    expect(rolloutStatus(base).complete).toBe(false);
    expect(
      rolloutStatus({
        metadata: { generation: 5 },
        spec: { replicas: 2 },
        status: { observedGeneration: 4, replicas: 2, updatedReplicas: 2, availableReplicas: 2 },
      }).complete,
    ).toBe(false);
  });
});

describe("parseRevision", () => {
  it("accepts positive integers and numeric strings only", () => {
    expect(parseRevision(2)).toBe(2);
    expect(parseRevision("4")).toBe(4);
    for (const bad of [0, -1, 1.5, "x", undefined]) expect(() => parseRevision(bad)).toThrow(/revision/);
  });
});
