/**
 * Server-side apply against the real k3s cluster.
 *
 *   docker compose up -d k3s && bash seed/kubernetes.sh
 *   BAKLAVA_INTEGRATION=1 npx vitest run --project=integration src/lib/connections/kubernetes/apply.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { reachable } from "@/test/integration-helpers";
import type { KubernetesConfig } from "../types";

const KUBECONFIG =
  process.env.BAKLAVA_KUBECONFIG ?? resolve(process.cwd(), ".kube/kubeconfig.yaml");
const cfg: KubernetesConfig = { source: "path", kubeconfigPath: KUBECONFIG };
const ID = "it-kubernetes-apply";
const NS = "demo";
const CM = `baklava-apply-it-${process.pid}`;
const SEC = `baklava-apply-it-sec-${process.pid}`;

const cmYaml = (data: Record<string, string>) =>
  `apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${CM}\ndata:\n${Object.entries(data)
    .map(([k, v]) => `  ${k}: "${v}"`)
    .join("\n")}\n`;
const secYaml = (v: string) =>
  `apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${SEC}\ntype: Opaque\nstringData:\n  password: ${v}\n`;

describe("kubernetes server-side apply", async () => {
  const up = (await reachable("127.0.0.1", 6443)) && existsSync(KUBECONFIG);

  async function exists(kind: string, name: string): Promise<boolean> {
    const { bundleFor } = await import("../kubernetes");
    const b = await bundleFor(ID, cfg);
    return b.objects
      .read({ apiVersion: "v1", kind, metadata: { name, namespace: NS } })
      .then(() => true)
      .catch(() => false);
  }

  async function cleanup() {
    const { bundleFor } = await import("../kubernetes");
    const b = await bundleFor(ID, cfg);
    for (const [kind, name] of [["ConfigMap", CM], ["Secret", SEC]]) {
      await b.objects.delete({ apiVersion: "v1", kind, metadata: { name, namespace: NS } }).catch(() => {});
    }
  }

  beforeAll(async () => {
    if (!up) console.warn(`[skip] k3s not reachable on 127.0.0.1:6443 or no kubeconfig at ${KUBECONFIG}`);
    else await cleanup();
  });
  afterAll(async () => {
    if (up) await cleanup();
  });

  it.skipIf(!up)("dry-run of a new ConfigMap reports created and creates nothing", async () => {
    const { applyManifests } = await import("./apply");
    const [r] = await applyManifests(ID, cfg, cmYaml({ a: "1" }), { namespace: NS, dryRun: true });
    expect(r.action).toBe("created");
    expect(r.namespace).toBe(NS);
    expect(r.diff).toContain(`+  name: ${CM}`);
    expect(await exists("ConfigMap", CM)).toBe(false);
  });

  it.skipIf(!up)("apply creates it, and re-applying is unchanged", async () => {
    const { applyManifests } = await import("./apply");
    const [r] = await applyManifests(ID, cfg, cmYaml({ a: "1" }), { namespace: NS, dryRun: false });
    expect(r.action).toBe("created");
    expect(await exists("ConfigMap", CM)).toBe(true);
    const [again] = await applyManifests(ID, cfg, cmYaml({ a: "1" }), { namespace: NS, dryRun: true });
    expect(again.action).toBe("unchanged");
    expect(again.diff).toBe("");
  });

  it.skipIf(!up)("a changed key dry-runs as configured with that key in the diff, without persisting", async () => {
    const { applyManifests } = await import("./apply");
    const [r] = await applyManifests(ID, cfg, cmYaml({ a: "1", fresh: "2" }), { namespace: NS, dryRun: true });
    expect(r.action).toBe("configured");
    expect(r.diff).toContain('+  fresh: "2"');
    const { bundleFor } = await import("../kubernetes");
    const live = (await (await bundleFor(ID, cfg)).objects.read({
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: CM, namespace: NS },
    })) as { data?: Record<string, string> };
    expect(live.data).toEqual({ a: "1" });
  });

  it.skipIf(!up)("a field owned by another manager is a conflict with its field path", async () => {
    const { bundleFor, getK8s } = await import("../kubernetes");
    const { PatchStrategy } = await getK8s();
    const b = await bundleFor(ID, cfg);
    await b.objects.patch(
      { apiVersion: "v1", kind: "ConfigMap", metadata: { name: CM, namespace: NS }, data: { a: "other" } },
      undefined,
      undefined,
      "someone-else",
      true,
      PatchStrategy.ServerSideApply,
    );
    const { applyManifests } = await import("./apply");
    const [r] = await applyManifests(ID, cfg, cmYaml({ a: "1" }), { namespace: NS, dryRun: true });
    expect(r.action).toBe("conflict");
    expect(r.conflicts?.some((c) => c.field === ".data.a")).toBe(true);
    const [forced] = await applyManifests(ID, cfg, cmYaml({ a: "1" }), { namespace: NS, dryRun: true, force: true });
    expect(forced.action).toBe("configured");
  });

  it.skipIf(!up)("a Secret diff carries keys, never values", async () => {
    const { applyManifests } = await import("./apply");
    const [created] = await applyManifests(ID, cfg, secYaml("hunter2-original"), { namespace: NS, dryRun: false });
    expect(created.action).toBe("created");
    const [r] = await applyManifests(ID, cfg, secYaml("hunter2-rotated"), { namespace: NS, dryRun: true });
    expect(r.action).toBe("configured");
    expect(r.diff).toContain("password: (hidden, changed)");
    for (const v of ["hunter2-original", "hunter2-rotated"]) {
      expect(r.diff).not.toContain(v);
      expect(r.diff).not.toContain(Buffer.from(v).toString("base64"));
    }
  });
});
