import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/kubernetes", () => ({
  listPods: vi.fn(async () => []),
  listDeployments: vi.fn(async () => []),
  listServices: vi.fn(async () => []),
  listConfigMaps: vi.fn(async () => []),
  listSecrets: vi.fn(async () => []),
  listNamespaces: vi.fn(async () => []),
  listNodes: vi.fn(async () => []),
  listEvents: vi.fn(async () => []),
  listStatefulSets: vi.fn(async () => []),
  listDaemonSets: vi.fn(async () => []),
  listJobs: vi.fn(async () => []),
  listCronJobs: vi.fn(async () => []),
  listIngresses: vi.fn(async () => []),
  listPvcs: vi.fn(async () => []),
  describeResource: vi.fn(async () => "Name:  api-0"),
  scaleDeployment: vi.fn(async () => undefined),
  restartDeployment: vi.fn(async () => undefined),
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

describe("kubernetesTools coverage", () => {
  const tools = () => kubernetesTools("c1", cfg as never, DEFAULT_POLICY);

  it("can list every kind the workspace shows", () => {
    const names = tools().map((t) => t.name);
    for (const kind of [
      "pods",
      "deployments",
      "services",
      "configmaps",
      "secrets",
      "namespaces",
      "nodes",
      "events",
      "statefulsets",
      "daemonsets",
      "jobs",
      "cronjobs",
      "ingresses",
      "pvcs",
    ]) {
      expect(names).toContain(`k8s_list_${kind}`);
    }
  });

  it("accepts every kind the driver can resolve", async () => {
    const get = tools().find((t) => t.name === "k8s_get_yaml")!;
    for (const kind of [
      "pod",
      "node",
      "event",
      "statefulset",
      "daemonset",
      "job",
      "cronjob",
      "ingress",
      "persistentvolumeclaim",
    ]) {
      expect(() => get.inputSchema.parse({ kind, name: "x" })).not.toThrow();
    }
  });

  it("exposes describe as a read", () => {
    const describe_ = tools().find((t) => t.name === "k8s_describe")!;
    expect(describe_.category).toBe("read");
  });

  it("exposes scale and restart as writes, not destructive", () => {
    const cat = Object.fromEntries(tools().map((t) => [t.name, t.category]));
    expect(cat["k8s_scale_deployment"]).toBe("write");
    expect(cat["k8s_restart_deployment"]).toBe("write");
  });

  it("scale delegates with a validated replica count", async () => {
    const scale = tools().find((t) => t.name === "k8s_scale_deployment")!;
    await scale.execute({ namespace: "demo", name: "api", replicas: 3 });
    expect(k.scaleDeployment).toHaveBeenCalledWith("c1", cfg, "demo", "api", 3);
    expect(() =>
      scale.inputSchema.parse({ namespace: "demo", name: "api", replicas: -1 }),
    ).toThrow();
  });

  it("restart delegates", async () => {
    const restart = tools().find((t) => t.name === "k8s_restart_deployment")!;
    await restart.execute({ namespace: "demo", name: "api" });
    expect(k.restartDeployment).toHaveBeenCalledWith("c1", cfg, "demo", "api");
  });
});
