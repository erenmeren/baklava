import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/kubernetes", () => ({
  listPods: vi.fn(async () => []),
  listDeployments: vi.fn(async () => []),
  listServices: vi.fn(async () => []),
  listConfigMaps: vi.fn(async () => []),
  listSecrets: vi.fn(async () => []),
  listNamespaces: vi.fn(async () => []),
  getPodLogs: vi.fn(async () => "log line"),
  readResourceYaml: vi.fn(async () => "kind: Secret"),
  replaceResourceYaml: vi.fn(async () => undefined),
  deleteResource: vi.fn(async () => undefined),
}));

import * as k from "@/lib/connections/kubernetes";
import { kubernetesTools } from "./kubernetes";
import { DEFAULT_POLICY } from "../permissions";

const cfg = { source: "path" as const, kubeconfigPath: "~/.kube/config" };

describe("kubernetesTools", () => {
  beforeEach(() => vi.clearAllMocks());
  it("tags categories and excludes exec", () => {
    const ts = kubernetesTools("c1", cfg as never, DEFAULT_POLICY);
    const cat = Object.fromEntries(ts.map((t) => [t.name, t.category]));
    const names = ts.map((t) => t.name);
    expect(cat["k8s_pod_logs"]).toBe("read");
    expect(cat["k8s_apply_yaml"]).toBe("write");
    expect(cat["k8s_delete_resource"]).toBe("destructive");
    expect(names.some((n) => n.includes("exec"))).toBe(false);
  });
  it("k8s_get_yaml redacts secrets by default", async () => {
    const t = kubernetesTools("c1", cfg as never, DEFAULT_POLICY).find((x) => x.name === "k8s_get_yaml")!;
    await t.execute({ kind: "secret", namespace: "default", name: "s" });
    expect(k.readResourceYaml).toHaveBeenCalledWith("c1", cfg, "secret", "default", "s", { redactSecretValues: true });
  });
  it("k8s_get_yaml passes values through when policy opts in", async () => {
    const policy = { ...DEFAULT_POLICY, allowK8sSecretValues: true };
    const t = kubernetesTools("c1", cfg as never, policy).find((x) => x.name === "k8s_get_yaml")!;
    await t.execute({ kind: "secret", namespace: "default", name: "s" });
    expect(k.readResourceYaml).toHaveBeenCalledWith("c1", cfg, "secret", "default", "s", { redactSecretValues: false });
  });
  it("k8s_delete_resource delegates", async () => {
    const t = kubernetesTools("c1", cfg as never, DEFAULT_POLICY).find((x) => x.name === "k8s_delete_resource")!;
    await t.execute({ kind: "pod", namespace: "default", name: "p" });
    expect(k.deleteResource).toHaveBeenCalledWith("c1", cfg, "pod", "default", "p");
  });
});
