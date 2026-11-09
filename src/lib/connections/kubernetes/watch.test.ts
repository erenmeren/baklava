import { describe, it, expect } from "vitest";
import { WATCH_SPECS, toWatchEvent, watchPath } from "./watch";
import { K8S_RESOURCES } from "@/lib/kubernetes/commands";

const now = new Date("2026-01-01T00:00:00Z");

describe("watch specs", () => {
  it("covers every workspace list", () => {
    expect(Object.keys(WATCH_SPECS).sort()).toEqual(K8S_RESOURCES.map((r) => r.path).sort());
  });

  it("scopes namespaced lists to the namespace, cluster-wide otherwise", () => {
    expect(watchPath(WATCH_SPECS.pods, "demo")).toBe("/api/v1/namespaces/demo/pods");
    expect(watchPath(WATCH_SPECS.pods, "*")).toBe("/api/v1/pods");
    expect(watchPath(WATCH_SPECS.deployments, "demo")).toBe("/apis/apps/v1/namespaces/demo/deployments");
    expect(watchPath(WATCH_SPECS.ingresses, "*")).toBe("/apis/networking.k8s.io/v1/ingresses");
    expect(watchPath(WATCH_SPECS.pvcs, "demo")).toBe("/api/v1/namespaces/demo/persistentvolumeclaims");
    // Cluster-scoped kinds ignore the namespace.
    expect(watchPath(WATCH_SPECS.nodes, "demo")).toBe("/api/v1/nodes");
    expect(watchPath(WATCH_SPECS.namespaces, "demo")).toBe("/api/v1/namespaces");
    expect(watchPath(WATCH_SPECS.hpas, "demo")).toBe("/apis/autoscaling/v2/namespaces/demo/horizontalpodautoscalers");
    expect(watchPath(WATCH_SPECS.clusterroles, "demo")).toBe("/apis/rbac.authorization.k8s.io/v1/clusterroles");
    expect(watchPath(WATCH_SPECS.crds, "demo")).toBe("/apis/apiextensions.k8s.io/v1/customresourcedefinitions");
  });
});

describe("toWatchEvent", () => {
  const cm = {
    metadata: { name: "cfg", namespace: "demo", resourceVersion: "42", creationTimestamp: "2025-12-31T23:59:00Z" },
    data: { a: "1", b: "2" },
  };

  it("maps ADDED/MODIFIED to an upsert of the page's row shape", () => {
    expect(toWatchEvent(WATCH_SPECS.configmaps, "ADDED", cm, now)).toEqual({
      type: "upsert",
      row: expect.objectContaining({ name: "cfg", namespace: "demo", dataKeys: 2 }),
    });
    expect(toWatchEvent(WATCH_SPECS.configmaps, "MODIFIED", cm, now)?.type).toBe("upsert");
  });

  it("maps DELETED to the row key", () => {
    expect(toWatchEvent(WATCH_SPECS.configmaps, "DELETED", cm, now)).toEqual({
      type: "delete",
      key: "demo/cfg",
    });
  });

  it("never lets a Secret's values through", () => {
    const secret = {
      metadata: { name: "db", namespace: "demo" },
      type: "Opaque",
      data: { password: "aHVudGVyMg==" },
      stringData: { token: "plain" },
    };
    const ev = toWatchEvent(WATCH_SPECS.secrets, "ADDED", secret, now);
    const json = JSON.stringify(ev);
    expect(json).not.toContain("aHVudGVyMg==");
    expect(json).not.toContain("plain");
    expect(json).not.toContain("password");
    expect(ev).toEqual({ type: "upsert", row: expect.objectContaining({ dataKeys: 2 }) });
  });

  it("turns a 410 into a re-list and other errors into an error", () => {
    expect(toWatchEvent(WATCH_SPECS.pods, "ERROR", { kind: "Status", code: 410 })).toEqual({ type: "gone" });
    expect(toWatchEvent(WATCH_SPECS.pods, "ERROR", { kind: "Status", code: 500, message: "boom" })).toEqual({
      type: "error",
      message: "boom",
    });
  });

  it("passes bookmarks through as a resume point and ignores unknown phases", () => {
    expect(toWatchEvent(WATCH_SPECS.pods, "BOOKMARK", { metadata: { resourceVersion: "9" } })).toEqual({
      type: "bookmark",
      resourceVersion: "9",
    });
    expect(toWatchEvent(WATCH_SPECS.pods, "WHAT", {})).toBeNull();
  });
});
