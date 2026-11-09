/**
 * Cluster topology against a real cluster:
 * `docker compose up -d k3s && bash seed/kubernetes.sh`, then
 * `BAKLAVA_INTEGRATION=1 npx vitest run --project=integration <this file>`.
 * Skips when the API server isn't reachable.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { reachable } from "@/test/integration-helpers";
import type { KubernetesConfig } from "../types";

const KUBECONFIG =
  process.env.BAKLAVA_KUBECONFIG ?? resolve(process.cwd(), ".kube/kubeconfig.yaml");
const cfg: KubernetesConfig = { source: "path", kubeconfigPath: KUBECONFIG };

describe("kubernetes topology", async () => {
  const up = (await reachable("127.0.0.1", 6443)) && existsSync(KUBECONFIG);

  it.skipIf(!up)("places the seeded workloads on the k3s control-plane node", async () => {
    const { getClusterTopology } = await import("./topology");
    const t = await getClusterTopology("it-k8s-topology", cfg, "demo");
    expect(t.notes).toEqual([]);
    expect(t.metricsMissing).toBe(false);
    // Single-node k3s labels its node control-plane (and master).
    expect(t.nodes.length).toBeGreaterThan(0);
    expect(t.nodes[0]).toMatchObject({ role: "control-plane", ready: true });
    expect(t.summary.controlPlane).toBe(t.summary.nodes);
    expect(t.nodes[0].cpu!.pct).not.toBeNull();

    const workloads = t.nodes.flatMap((n) => n.workloads);
    const storefront = workloads.find((w) => w.name === "storefront");
    expect(storefront).toMatchObject({ kind: "Deployment", namespace: "demo", problem: false });
    expect(storefront!.replicas).toBeGreaterThanOrEqual(2);
    expect(storefront!.cpuPerPod).not.toBeNull();

    const broken = [...workloads, ...t.unscheduled].find((w) => w.name === "broken-image");
    expect(broken).toMatchObject({ kind: "Pod", problem: true });
    // ?ns= scopes pods only.
    expect(workloads.every((w) => w.namespace === "demo")).toBe(true);
  });
});
