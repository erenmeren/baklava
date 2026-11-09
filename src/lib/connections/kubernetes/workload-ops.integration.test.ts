/**
 * Rollout / StatefulSet / CronJob / aggregated-log actions against the real
 * k3s cluster (see kubernetes.integration.test.ts for setup). Every object the
 * tests mutate is a throwaway created here with zero replicas — no pods, no
 * image pulls — and deleted afterwards; the seeded `storefront` Deployment is
 * only read.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { reachable } from "@/test/integration-helpers";
import type { KubernetesConfig } from "../types";

const KUBECONFIG =
  process.env.BAKLAVA_KUBECONFIG ?? resolve(process.cwd(), ".kube/kubeconfig.yaml");
const cfg: KubernetesConfig = { source: "path", kubeconfigPath: KUBECONFIG };
const ID = "it-kubernetes-workload-ops";
const NS = "demo";
const SUFFIX = Date.now().toString(36);
const DEPLOY = `it-rollout-${SUFFIX}`;
const STS = `it-sts-${SUFFIX}`;
const CJ = `it-cron-${SUFFIX}`;

const podTemplate = (app: string, image: string) => ({
  metadata: { labels: { app } },
  spec: { containers: [{ name: "main", image }] },
});

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("kubernetes workload ops", async () => {
  const up = (await reachable("127.0.0.1", 6443)) && existsSync(KUBECONFIG);

  beforeAll(async () => {
    if (!up) {
      console.warn(`[skip] k3s not reachable on 127.0.0.1:6443 or no kubeconfig at ${KUBECONFIG}`);
      return;
    }
    const { bundleFor } = await import("../kubernetes");
    const b = await bundleFor(ID, cfg);
    await b.apps.createNamespacedDeployment({
      namespace: NS,
      body: {
        metadata: { name: DEPLOY },
        spec: {
          replicas: 0,
          selector: { matchLabels: { app: DEPLOY } },
          template: podTemplate(DEPLOY, "registry.k8s.io/pause:3.9"),
        },
      },
    });
    await b.apps.createNamespacedStatefulSet({
      namespace: NS,
      body: {
        metadata: { name: STS },
        spec: {
          replicas: 0,
          serviceName: STS,
          selector: { matchLabels: { app: STS } },
          template: podTemplate(STS, "registry.k8s.io/pause:3.9"),
        },
      },
    });
    await b.batch.createNamespacedCronJob({
      namespace: NS,
      body: {
        metadata: { name: CJ },
        spec: {
          schedule: "0 0 1 1 *",
          suspend: true,
          jobTemplate: {
            spec: {
              // Never actually runs a pod: the test only checks the Job exists.
              suspend: true,
              template: {
                spec: {
                  restartPolicy: "Never",
                  containers: [{ name: "main", image: "registry.k8s.io/pause:3.9" }],
                },
              },
            },
          },
        },
      },
    });
  });

  afterAll(async () => {
    if (!up) return;
    const { bundleFor } = await import("../kubernetes");
    const b = await bundleFor(ID, cfg);
    const bg = { propagationPolicy: "Background" };
    await Promise.allSettled([
      b.apps.deleteNamespacedDeployment({ namespace: NS, name: DEPLOY, ...bg }),
      b.apps.deleteNamespacedStatefulSet({ namespace: NS, name: STS, ...bg }),
      b.batch.deleteNamespacedCronJob({ namespace: NS, name: CJ, ...bg }),
    ]);
  });

  it.skipIf(!up)("set image → 2 revisions → undo restores the image", async () => {
    const { bundleFor, getK8s } = await import("../kubernetes");
    const { getRollout, undoRollout } = await import("./workload-ops");
    const b = await bundleFor(ID, cfg);
    const { PatchStrategy, setHeaderOptions } = await getK8s();

    await until(
      () => getRollout(ID, cfg, NS, DEPLOY),
      (r) => r.history.length === 1,
    );
    await b.apps.patchNamespacedDeployment(
      {
        namespace: NS,
        name: DEPLOY,
        body: {
          metadata: { annotations: { "kubernetes.io/change-cause": "bump pause" } },
          spec: { template: { spec: { containers: [{ name: "main", image: "registry.k8s.io/pause:3.10" }] } } },
        },
      },
      setHeaderOptions("Content-Type", PatchStrategy.StrategicMergePatch),
    );

    const two = await until(
      () => getRollout(ID, cfg, NS, DEPLOY),
      (r) => r.history.length === 2 && r.history[0].current,
    );
    expect(two.history.map((r) => r.revision)).toEqual([2, 1]);
    expect(two.history[0].images).toEqual(["registry.k8s.io/pause:3.10"]);
    expect(two.history[1].images).toEqual(["registry.k8s.io/pause:3.9"]);
    expect(two.status.desired).toBe(0);

    await undoRollout(ID, cfg, NS, DEPLOY, 1);
    const d = await b.apps.readNamespacedDeployment({ namespace: NS, name: DEPLOY });
    expect(d.spec?.template.spec?.containers[0].image).toBe("registry.k8s.io/pause:3.9");
    // the controller's hash label was not written back onto the template
    expect(d.spec?.template.metadata?.labels?.["pod-template-hash"]).toBeUndefined();

    // the old ReplicaSet is reused as revision 3, so history stays at 2 entries
    const after = await until(
      () => getRollout(ID, cfg, NS, DEPLOY),
      (r) => r.history[0]?.revision === 3,
    );
    expect(after.history[0]).toMatchObject({ revision: 3, current: true, images: ["registry.k8s.io/pause:3.9"] });
  });

  it.skipIf(!up)("statefulset restart bumps the annotation; scale patches replicas", async () => {
    const { bundleFor } = await import("../kubernetes");
    const { restartWorkload, scaleStatefulSet } = await import("./workload-ops");
    const b = await bundleFor(ID, cfg);
    const key = "kubectl.kubernetes.io/restartedAt";

    await restartWorkload(ID, cfg, "statefulset", NS, STS);
    const first = (await b.apps.readNamespacedStatefulSet({ namespace: NS, name: STS })).spec
      ?.template.metadata?.annotations?.[key];
    expect(first).toBeTruthy();

    await new Promise((r) => setTimeout(r, 1100));
    await restartWorkload(ID, cfg, "statefulset", NS, STS);
    const second = (await b.apps.readNamespacedStatefulSet({ namespace: NS, name: STS })).spec
      ?.template.metadata?.annotations?.[key];
    expect(second).not.toBe(first);

    await scaleStatefulSet(ID, cfg, NS, STS, 0);
    const sts = await b.apps.readNamespacedStatefulSet({ namespace: NS, name: STS });
    expect(sts.spec?.replicas).toBe(0);
  });

  it.skipIf(!up)("cronjob trigger creates an owned manual Job; suspend toggles", async () => {
    const { bundleFor } = await import("../kubernetes");
    const { setCronJobSuspended, triggerCronJob } = await import("./workload-ops");
    const b = await bundleFor(ID, cfg);

    const jobName = await triggerCronJob(ID, cfg, NS, CJ);
    expect(jobName).toMatch(new RegExp(`^${CJ}-manual-[0-9a-f]{6}$`));
    const job = await b.batch.readNamespacedJob({ namespace: NS, name: jobName });
    expect(job.metadata?.annotations?.["cronjob.kubernetes.io/instantiate"]).toBe("manual");
    expect(job.metadata?.ownerReferences?.[0]).toMatchObject({ kind: "CronJob", name: CJ });

    await setCronJobSuspended(ID, cfg, NS, CJ, false);
    expect((await b.batch.readNamespacedCronJob({ namespace: NS, name: CJ })).spec?.suspend).toBe(false);
    await setCronJobSuspended(ID, cfg, NS, CJ, true);
    expect((await b.batch.readNamespacedCronJob({ namespace: NS, name: CJ })).spec?.suspend).toBe(true);
  });

  it.skipIf(!up)("aggregated logs follow every storefront pod's chosen container", async () => {
    const { streamWorkloadLogs } = await import("./workload-ops");
    const res = await streamWorkloadLogs(ID, cfg, "deployment", NS, "storefront", {
      container: "sidecar",
    });
    try {
      expect(res.sources.length).toBe(2);
      expect(res.truncated).toBe(false);
      expect(res.sources.every((s) => s.container === "sidecar")).toBe(true);
      expect(new Set(res.sources.map((s) => s.pod)).size).toBe(2);
    } finally {
      for (const s of res.sources) s.stream.abort();
    }
  });
});
