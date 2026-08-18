import { describe, it, expect } from "vitest";
import { K8S_RESOURCES, resolveCommand } from "./commands";

describe("resolveCommand", () => {
  it("navigates on a resource's full name", () => {
    expect(resolveCommand("pods")).toEqual({ kind: "navigate", target: "pods" });
  });

  it("navigates on the k9s short alias", () => {
    expect(resolveCommand("po")).toEqual({ kind: "navigate", target: "pods" });
    expect(resolveCommand("deploy")).toEqual({ kind: "navigate", target: "deployments" });
    expect(resolveCommand("sts")).toEqual({ kind: "navigate", target: "statefulsets" });
    expect(resolveCommand("cj")).toEqual({ kind: "navigate", target: "cronjobs" });
    expect(resolveCommand("ing")).toEqual({ kind: "navigate", target: "ingresses" });
    expect(resolveCommand("pvc")).toEqual({ kind: "navigate", target: "pvcs" });
    expect(resolveCommand("no")).toEqual({ kind: "navigate", target: "nodes" });
    expect(resolveCommand("ev")).toEqual({ kind: "navigate", target: "events" });
  });

  it("ignores case and surrounding whitespace", () => {
    expect(resolveCommand("  PODS  ")).toEqual({ kind: "navigate", target: "pods" });
  });

  it("switches namespace when ns carries an argument", () => {
    expect(resolveCommand("ns payments")).toEqual({ kind: "namespace", namespace: "payments" });
    expect(resolveCommand("namespace payments")).toEqual({
      kind: "namespace",
      namespace: "payments",
    });
  });

  it("navigates to the namespaces list when ns carries no argument", () => {
    expect(resolveCommand("ns")).toEqual({ kind: "navigate", target: "namespaces" });
  });

  it("understands both spellings of all-namespaces", () => {
    expect(resolveCommand("ns *")).toEqual({ kind: "namespace", namespace: "*" });
    expect(resolveCommand("ns all")).toEqual({ kind: "namespace", namespace: "*" });
  });

  it("returns null for nonsense so the caller can leave the palette open", () => {
    expect(resolveCommand("wat")).toBeNull();
    expect(resolveCommand("")).toBeNull();
    expect(resolveCommand("   ")).toBeNull();
  });

  it("every listed resource resolves to itself", () => {
    for (const r of K8S_RESOURCES) {
      expect(resolveCommand(r.path)).toEqual({ kind: "navigate", target: r.path });
      for (const alias of r.aliases) {
        expect(resolveCommand(alias)).toEqual({ kind: "navigate", target: r.path });
      }
    }
  });

  it("covers every resource the sidebar can reach", () => {
    expect(K8S_RESOURCES.map((r) => r.path)).toEqual([
      "pods",
      "deployments",
      "statefulsets",
      "daemonsets",
      "jobs",
      "cronjobs",
      "services",
      "ingresses",
      "configmaps",
      "secrets",
      "pvcs",
      "namespaces",
      "nodes",
      "events",
    ]);
  });

  it("assigns no duplicate aliases", () => {
    const all = K8S_RESOURCES.flatMap((r) => [r.path, ...r.aliases]);
    expect(new Set(all).size).toBe(all.length);
  });
});
