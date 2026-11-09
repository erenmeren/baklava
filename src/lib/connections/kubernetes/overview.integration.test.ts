/**
 * Cluster overview + context switching against a real cluster:
 * `docker compose up -d k3s && bash seed/kubernetes.sh`, then
 * `BAKLAVA_INTEGRATION=1 npx vitest run --project=integration <this file>`.
 * Skips when the API server isn't reachable.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { reachable } from "@/test/integration-helpers";
import type { KubernetesConfig } from "../types";

const KUBECONFIG =
  process.env.BAKLAVA_KUBECONFIG ?? resolve(process.cwd(), ".kube/kubeconfig.yaml");
const cfg: KubernetesConfig = { source: "path", kubeconfigPath: KUBECONFIG };

describe("kubernetes overview", async () => {
  const up = (await reachable("127.0.0.1", 6443)) && existsSync(KUBECONFIG);

  it.skipIf(!up)("aggregates the whole cluster and flags broken-image", async () => {
    const { getClusterOverview } = await import("./overview");
    const o = await getClusterOverview("it-k8s-overview", cfg, "*");
    expect(o.notes).toEqual([]);
    expect(o.nodes!.total).toBeGreaterThan(0);
    expect(o.nodes!.ready).toBe(o.nodes!.total);
    expect(o.pods!.Running).toBeGreaterThan(0);
    const broken = o.attention.find((a) => a.name === "broken-image");
    expect(broken).toMatchObject({ kind: "Pod", namespace: "demo" });
    expect(["ImagePullBackOff", "Pending"]).toContain(broken!.reason);
    expect(o.warnings!.length).toBeGreaterThan(0);
    // k3s bundles metrics-server.
    expect(o.metricsMissing).toBe(false);
    expect(o.usage!.cpuAllocatable).toBeGreaterThan(0);
    expect(o.usage!.memBytes).toBeGreaterThan(0);
  });

  it.skipIf(!up)("scopes namespaced sections to ?ns=", async () => {
    const { getClusterOverview } = await import("./overview");
    const o = await getClusterOverview("it-k8s-overview", cfg, "kube-system");
    expect(o.namespace).toBe("kube-system");
    expect(o.attention.some((a) => a.name === "broken-image")).toBe(false);
    expect(o.pods!.total).toBeGreaterThan(0);
  });

  it.skipIf(!up)("switching context rebuilds the cached client", async () => {
    const { bundleFor } = await import("../kubernetes");
    // Two contexts, one cluster — the inline kubeconfig the context switcher sees.
    const src = readFileSync(KUBECONFIG, "utf8");
    const { KubeConfig } = await import("@kubernetes/client-node");
    const kc = new KubeConfig();
    kc.loadFromString(src);
    const ctx = kc.getContextObject(kc.currentContext)!;
    kc.addContext({ ...ctx, name: "second" });
    const yaml = kc.exportConfig();
    const id = "it-k8s-context";
    const a = await bundleFor(id, { source: "inline", kubeconfigYaml: yaml });
    const b = await bundleFor(id, { source: "inline", kubeconfigYaml: yaml, context: "second" });
    expect(b).not.toBe(a);
    expect(a.kc.getContexts().map((c) => c.name).sort()).toEqual([ctx.name, "second"].sort());
    expect(b.kc.currentContext).toBe("second");
    const nodes = await b.core.listNode();
    expect(nodes.items.length).toBeGreaterThan(0);
  });
});
