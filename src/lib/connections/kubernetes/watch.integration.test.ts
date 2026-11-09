/**
 * The watch stream against a real cluster: `docker compose up -d k3s &&
 * bash seed/kubernetes.sh`, then
 * `BAKLAVA_INTEGRATION=1 npx vitest run --project=integration <this file>`.
 * Skips when the API server isn't reachable.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { reachable } from "@/test/integration-helpers";
import type { KubernetesConfig } from "../types";
import type { KeyedRow, WatchReset } from "@/lib/kubernetes/watch-merge";

const KUBECONFIG =
  process.env.BAKLAVA_KUBECONFIG ?? resolve(process.cwd(), ".kube/kubeconfig.yaml");
const cfg: KubernetesConfig = { source: "path", kubeconfigPath: KUBECONFIG };
const ID = "it-kubernetes-watch";
const NS = "demo";

async function until(check: () => boolean, ms = 15_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for watch event");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("kubernetes watch", async () => {
  const up = (await reachable("127.0.0.1", 6443)) && existsSync(KUBECONFIG);

  it.skipIf(!up)("streams a ConfigMap's create and delete", async () => {
    const { watchResource } = await import("./watch");
    const { bundleFor } = await import("../kubernetes");
    const b = await bundleFor(ID, cfg);
    const name = `baklava-watch-${Date.now()}`;

    const resets: WatchReset<KeyedRow>[] = [];
    const upserts: KeyedRow[] = [];
    const deletes: string[] = [];
    const ac = new AbortController();
    const running = watchResource(
      ID,
      cfg,
      "configmaps",
      NS,
      {
        reset: (p) => resets.push(p),
        upsert: (r) => upserts.push(r),
        remove: (k) => deletes.push(k),
      },
      ac.signal,
    );
    try {
      await until(() => resets.length === 1);
      expect(resets[0].rows.length).toBeGreaterThan(0);
      expect(resets[0].rows.every((r) => r.namespace === NS)).toBe(true);
      expect(resets[0].rows.some((r) => r.name === name)).toBe(false);

      await b.core.createNamespacedConfigMap({
        namespace: NS,
        body: { metadata: { name }, data: { k: "v" } },
      });
      await until(() => upserts.some((r) => r.name === name));
      expect(upserts.find((r) => r.name === name)).toMatchObject({
        name,
        namespace: NS,
        dataKeys: 1,
      });

      await b.core.deleteNamespacedConfigMap({ name, namespace: NS });
      await until(() => deletes.includes(`${NS}/${name}`));
    } finally {
      ac.abort();
      await running;
      await b.core.deleteNamespacedConfigMap({ name, namespace: NS }).catch(() => {});
    }
  }, 30_000);

  it.skipIf(!up)("every workspace list seeds a reset and holds its watch open", async () => {
    const { watchResource, WATCH_SPECS } = await import("./watch");
    for (const resource of Object.keys(WATCH_SPECS)) {
      const ac = new AbortController();
      let reset: WatchReset<KeyedRow> | null = null;
      let failed: unknown = null;
      const running = watchResource(
        ID,
        cfg,
        resource,
        "*",
        { reset: (p) => (reset = p), upsert: () => {}, remove: () => {} },
        ac.signal,
      ).catch((err) => (failed = err));
      await until(() => reset !== null || failed !== null);
      // A wrong watch path would 404 right after the list — give it a moment.
      await new Promise((r) => setTimeout(r, 300));
      expect({ resource, failed }).toEqual({ resource, failed: null });
      expect(reset!.truncated).toBe(false);
      ac.abort();
      await running;
    }
  }, 60_000);

  it.skipIf(!up)("abort ends the watch", async () => {
    const { watchResource } = await import("./watch");
    const ac = new AbortController();
    let reset = false;
    const running = watchResource(
      ID,
      cfg,
      "pods",
      NS,
      { reset: () => (reset = true), upsert: () => {}, remove: () => {} },
      ac.signal,
    );
    await until(() => reset);
    ac.abort();
    await expect(running).resolves.toBeUndefined();
  }, 30_000);
});
