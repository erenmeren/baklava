/**
 * The newer catalogue kinds and the demo CRD against a real cluster:
 * `docker compose up -d k3s && bash seed/kubernetes.sh`, then
 * `BAKLAVA_INTEGRATION=1 npx vitest run --project=integration <this file>`.
 * Skips when the API server isn't reachable. Object names come from
 * seed/k8s-extras.yaml and seed/k8s-widgets.yaml.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { reachable } from "@/test/integration-helpers";
import type { KubernetesConfig } from "../types";

const KUBECONFIG =
  process.env.BAKLAVA_KUBECONFIG ?? resolve(process.cwd(), ".kube/kubeconfig.yaml");
const cfg: KubernetesConfig = { source: "path", kubeconfigPath: KUBECONFIG };
const ID = "it-kubernetes-resources";

/** Catalogue path → a name the seed guarantees in it. */
const SEEDED: Array<[string, string, string]> = [
  ["replicasets", "demo", "autoscaled-"],
  ["hpas", "demo", "autoscaled"],
  ["pdbs", "demo", "autoscaled"],
  ["networkpolicies", "demo", "autoscaled-same-namespace"],
  ["resourcequotas", "demo", "demo-counts"],
  ["limitranges", "demo", "demo-pvc-size"],
  ["serviceaccounts", "demo", "config-reader"],
  ["roles", "demo", "config-reader"],
  ["rolebindings", "demo", "config-reader"],
  // Cluster-scoped: the namespace argument must be ignored.
  ["clusterroles", "demo", "cluster-admin"],
  ["clusterrolebindings", "demo", "cluster-admin"],
  ["storageclasses", "demo", "local-path"],
  ["crds", "demo", "widgets.demo.baklava.dev"],
];

describe("kubernetes catalogue kinds", async () => {
  const up = (await reachable("127.0.0.1", 6443)) && existsSync(KUBECONFIG);

  it.skipIf(!up).each(SEEDED)("lists %s with the seeded object", async (resource, ns, name) => {
    const { listResource } = await import("./watch");
    const list = await listResource<{ name: string; namespace?: string }>(ID, cfg, resource, ns);
    expect(list.truncated).toBe(false);
    expect(list.rows.some((r) => r.name.startsWith(name))).toBe(true);
  });

  // The seed's PVC waits for a consumer, so the cluster may hold no PV at all.
  it.skipIf(!up)("lists pvs cluster-wide", async () => {
    const { listResource } = await import("./watch");
    const list = await listResource<{ name: string; namespace?: string }>(ID, cfg, "pvs", "demo");
    expect(Array.isArray(list.rows)).toBe(true);
    for (const r of list.rows) expect(r).not.toHaveProperty("namespace");
  });

  it.skipIf(!up)("maps the seeded HPA, RoleBinding and quota", async () => {
    const { listResource } = await import("./watch");
    const [hpas, rbs, quotas] = await Promise.all([
      listResource<{ name: string; target: string; maxReplicas: number; metrics: string }>(ID, cfg, "hpas", "demo"),
      listResource<{ name: string; role: string; subjects: string }>(ID, cfg, "rolebindings", "demo"),
      listResource<{ name: string; usage: string }>(ID, cfg, "resourcequotas", "demo"),
    ]);
    const hpa = hpas.rows.find((r) => r.name === "autoscaled")!;
    expect(hpa).toMatchObject({ target: "Deployment/autoscaled", maxReplicas: 3 });
    expect(hpa.metrics).toMatch(/^cpu .+\/80%$/);
    expect(rbs.rows.find((r) => r.name === "config-reader")).toMatchObject({
      role: "Role/config-reader",
      subjects: "ServiceAccount/demo/config-reader",
    });
    expect(quotas.rows.find((r) => r.name === "demo-counts")!.usage).toMatch(/pods \d+\/100/);
  });

  it.skipIf(!up)("lists the demo CRD's instances with its printer columns", async () => {
    const { listCustomResources } = await import("./crds");
    const { crd, list } = await listCustomResources(ID, cfg, "demo.baklava.dev", "widgets", "demo");
    expect(crd).toMatchObject({ kind: "Widget", version: "v1", namespaced: true });
    expect(crd.columns.map((c) => c.name)).toEqual(["Color", "Size"]);
    const rows = Object.fromEntries(list.rows.map((r) => [r.name, r.cells]));
    expect(rows["small-blue"]).toEqual(["blue", "1"]);
    expect(rows["large-red"]).toEqual(["red", "9"]);
  });

  it.skipIf(!up)("links the demo CRD for the sidebar", async () => {
    const { listCrdLinks } = await import("./crds");
    expect(await listCrdLinks(ID, cfg)).toContainEqual({
      group: "demo.baklava.dev",
      plural: "widgets",
      kind: "Widget",
      namespaced: true,
    });
  });

  it.skipIf(!up)("reads and describes a CR instance through its CRD name", async () => {
    const { readResourceYaml, describeResource } = await import("../kubernetes");
    const yaml = await readResourceYaml(ID, cfg, "widgets.demo.baklava.dev", "demo", "small-blue");
    expect(yaml).toMatch(/kind: Widget/);
    expect(yaml).toMatch(/color: blue/);
    const text = await describeResource(ID, cfg, "widgets.demo.baklava.dev", "demo", "small-blue");
    expect(text).toMatch(/small-blue/);
  });

  it.skipIf(!up)("refuses an unknown CRD and a crafted CR identity", async () => {
    const { readResourceYaml } = await import("../kubernetes");
    await expect(readResourceYaml(ID, cfg, "nopes.demo.baklava.dev", "demo", "x")).rejects.toThrow(/Unsupported kind/);
    await expect(readResourceYaml(ID, cfg, "../secrets", "demo", "x")).rejects.toThrow(/Unsupported kind/);
  });
});
