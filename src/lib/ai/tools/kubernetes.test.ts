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
  proxyPodHttp: vi.fn(async () => ({ status: 200, body: "ok", truncated: false })),
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
    // A full replace of any kind (Secrets, RoleBindings, privileged pods).
    expect(cat["k8s_apply_yaml"]).toBe("destructive");
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

describe("k8s_pod_http", () => {
  const tool = () =>
    kubernetesTools("c1", cfg as never, DEFAULT_POLICY).find((t) => t.name === "k8s_pod_http")!;

  it("is a write — the pod decides what a GET does", () => {
    expect(tool().category).toBe("write");
  });

  it("delegates with the port and path", async () => {
    await tool().execute({ namespace: "demo", pod: "api-0", port: 80, path: "/healthz" });
    expect(k.proxyPodHttp).toHaveBeenCalledWith("c1", cfg, "demo", "api-0", 80, "/healthz");
  });

  it("defaults the path to root", () => {
    const parsed = tool().inputSchema.parse({ namespace: "d", pod: "p", port: 80 }) as {
      path: string;
    };
    expect(parsed.path).toBe("/");
  });

  it("rejects a port outside the valid range", () => {
    expect(() => tool().inputSchema.parse({ namespace: "d", pod: "p", port: 0 })).toThrow();
  });
});

describe("k8s_scale_deployment escalation", () => {
  const scale = () =>
    kubernetesTools("c1", cfg as never, DEFAULT_POLICY).find((t) => t.name === "k8s_scale_deployment")!;
  it("scaling to 0 stops every pod → destructive", () => {
    expect(scale().categoryFor?.({ replicas: 0 })).toBe("destructive");
    expect(scale().categoryFor?.({ replicas: 3 })).toBe("write");
  });
});

vi.mock("@/lib/connections/kubernetes/workload-ops", () => ({
  getRollout: vi.fn(async () => ({ status: {}, history: [] })),
  undoRollout: vi.fn(async () => undefined),
  restartWorkload: vi.fn(async () => undefined),
  scaleStatefulSet: vi.fn(async () => undefined),
  triggerCronJob: vi.fn(async () => "nightly-report-manual-abc123"),
  setCronJobSuspended: vi.fn(async () => undefined),
}));

describe("workload tools", async () => {
  const w = await import("@/lib/connections/kubernetes/workload-ops");
  const tool = (name: string) =>
    kubernetesTools("c1", cfg as never, DEFAULT_POLICY).find((t) => t.name === name)!;
  beforeEach(() => vi.clearAllMocks());

  it("tags rollout history read, undo destructive, the rest writes", () => {
    expect(tool("k8s_rollout_history").category).toBe("read");
    expect(tool("k8s_rollout_undo").category).toBe("destructive");
    for (const n of [
      "k8s_restart_workload",
      "k8s_scale_statefulset",
      "k8s_trigger_cronjob",
      "k8s_suspend_cronjob",
    ]) {
      expect(tool(n).category).toBe("write");
    }
  });

  it("scaling a statefulset to 0 escalates to destructive", () => {
    expect(tool("k8s_scale_statefulset").categoryFor?.({ replicas: 0 })).toBe("destructive");
    expect(tool("k8s_scale_statefulset").categoryFor?.({ replicas: 2 })).toBe("write");
  });

  it("undo delegates with the revision and rejects revision 0", async () => {
    await tool("k8s_rollout_undo").execute({ namespace: "demo", name: "api", revision: 2 });
    expect(w.undoRollout).toHaveBeenCalledWith("c1", cfg, "demo", "api", 2);
    expect(() =>
      tool("k8s_rollout_undo").inputSchema.parse({ namespace: "d", name: "a", revision: 0 }),
    ).toThrow();
  });

  it("restart_workload only names statefulsets and daemonsets", async () => {
    await tool("k8s_restart_workload").execute({ kind: "daemonset", namespace: "d", name: "x" });
    expect(w.restartWorkload).toHaveBeenCalledWith("c1", cfg, "daemonset", "d", "x");
    expect(() =>
      tool("k8s_restart_workload").inputSchema.parse({ kind: "deployment", namespace: "d", name: "x" }),
    ).toThrow();
  });

  it("trigger returns the created job and suspend passes the flag", async () => {
    const r = await tool("k8s_trigger_cronjob").execute({ namespace: "demo", name: "nightly-report" });
    expect(r).toEqual({ ok: true, job: "nightly-report-manual-abc123" });
    await tool("k8s_suspend_cronjob").execute({ namespace: "demo", name: "n", suspend: true });
    expect(w.setCronJobSuspended).toHaveBeenCalledWith("c1", cfg, "demo", "n", true);
  });
});

vi.mock("@/lib/connections/kubernetes/watch", () => ({
  listResource: vi.fn(async () => ({ items: [], truncated: false })),
}));
vi.mock("@/lib/connections/kubernetes/crds", () => ({
  listCustomResources: vi.fn(async () => ({ crd: {}, list: { items: [], truncated: false } })),
}));

describe("generic and custom-resource listing", () => {
  beforeEach(() => vi.clearAllMocks());
  const get = (n: string) => kubernetesTools("c1", cfg as never, DEFAULT_POLICY).find((t) => t.name === n)!;

  it("k8s_list_resources is a read over the catalogue path", async () => {
    const { listResource } = await import("@/lib/connections/kubernetes/watch");
    expect(get("k8s_list_resources").category).toBe("read");
    await get("k8s_list_resources").execute({ resource: "rolebindings", namespace: "demo" });
    expect(listResource).toHaveBeenCalledWith("c1", cfg, "rolebindings", "demo");
    expect(() => get("k8s_list_resources").inputSchema.parse({ resource: "secrets" })).toThrow();
  });

  it("k8s_list_custom_resources splits <plural>.<group> and rejects junk", async () => {
    const { listCustomResources } = await import("@/lib/connections/kubernetes/crds");
    await get("k8s_list_custom_resources").execute({ crd: "widgets.demo.baklava.dev" });
    expect(listCustomResources).toHaveBeenCalledWith("c1", cfg, "demo.baklava.dev", "widgets", "");
    for (const bad of ["widgets", "../x.y", "Widgets.demo.dev", "a/b.c"]) {
      expect(() => get("k8s_list_custom_resources").inputSchema.parse({ crd: bad })).toThrow();
    }
  });

  it("CRDs can be read but never deleted by the assistant; CR instances can", () => {
    expect(() =>
      get("k8s_get_yaml").inputSchema.parse({ kind: "customresourcedefinition", name: "widgets.demo.baklava.dev" }),
    ).not.toThrow();
    expect(() =>
      get("k8s_delete_resource").inputSchema.parse({ kind: "customresourcedefinition", name: "x" }),
    ).toThrow();
    expect(() =>
      get("k8s_delete_resource").inputSchema.parse({ kind: "widgets.demo.baklava.dev", namespace: "demo", name: "a" }),
    ).not.toThrow();
  });
});
