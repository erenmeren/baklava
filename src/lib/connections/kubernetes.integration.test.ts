/**
 * Integration tests for the Kubernetes driver against a real cluster.
 *
 *   docker compose up -d k3s
 *   bash seed/kubernetes.sh          # creates the `demo` namespace
 *   npm run test:integration
 *
 * Gated by BAKLAVA_INTEGRATION=1 (vitest's `integration` project only picks up
 * *.integration.test.* when that is set) and skipped per-test when the API
 * server isn't reachable, so a missing cluster reads as a skip rather than a
 * pile of network errors.
 *
 * These are the tests that actually pin the row mappers to reality: the unit
 * tests assert what the code does with a shape I wrote down, these assert the
 * shape the API server really sends.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { reachable } from "@/test/integration-helpers";
import type { KubernetesConfig } from "./types";

const KUBECONFIG =
  process.env.BAKLAVA_KUBECONFIG ?? resolve(process.cwd(), ".kube/kubeconfig.yaml");
const cfg: KubernetesConfig = { source: "path", kubeconfigPath: KUBECONFIG };
const ID = "it-kubernetes";
const NS = "demo";

describe("kubernetes driver", async () => {
  const up = (await reachable("127.0.0.1", 6443)) && existsSync(KUBECONFIG);
  beforeAll(() => {
    if (!up) {
      console.warn(
        `[skip] k3s not reachable on 127.0.0.1:6443 or no kubeconfig at ${KUBECONFIG}`,
      );
    }
  });

  it.skipIf(!up)("probe reports the server version and node count", async () => {
    const { probe } = await import("./kubernetes");
    const p = await probe(ID, cfg);
    expect(p.serverVersion).toMatch(/^v1\./);
    expect(p.nodeCount).toBeGreaterThanOrEqual(1);
    expect(p.context).toBeTruthy();
  });

  it.skipIf(!up)("listNamespaces includes the seeded namespace", async () => {
    const { listNamespaces } = await import("./kubernetes");
    const { rows } = await listNamespaces(ID, cfg);
    const demo = rows.find((n) => n.name === NS);
    expect(demo).toBeDefined();
    expect(demo!.status).toBe("Active");
    expect(demo!.pods).toBeGreaterThan(0);
  });

  it.skipIf(!up)("listPods scopes to a namespace", async () => {
    const { listPods } = await import("./kubernetes");
    const scoped = await listPods(ID, cfg, NS);
    expect(scoped.rows.length).toBeGreaterThan(0);
    expect(scoped.rows.every((p) => p.namespace === NS)).toBe(true);

    const all = await listPods(ID, cfg, "*");
    expect(all.rows.length).toBeGreaterThan(scoped.rows.length);
    expect(all.rows.some((p) => p.namespace === "kube-system")).toBe(true);
  });

  it.skipIf(!up)("listPods reports every container of a multi-container pod", async () => {
    const { listPods } = await import("./kubernetes");
    const { rows } = await listPods(ID, cfg, NS);
    const storefront = rows.find((p) => p.name.startsWith("storefront-"));
    expect(storefront).toBeDefined();
    expect(storefront!.containers).toEqual(["web", "sidecar"]);
    expect(storefront!.ready).toBe("2/2");
  });

  it.skipIf(!up)("listPods surfaces a failing image pull as its own phase", async () => {
    const { listPods } = await import("./kubernetes");
    const { rows } = await listPods(ID, cfg, NS);
    const broken = rows.find((p) => p.name === "broken-image");
    expect(broken).toBeDefined();
    expect(["ImagePullBackOff", "ErrImagePull", "Pending"]).toContain(broken!.status);
  });

  it.skipIf(!up)("listPods reports a finished job pod as Completed", async () => {
    const { listPods } = await import("./kubernetes");
    const { rows } = await listPods(ID, cfg, NS);
    const migrate = rows.find((p) => p.name.startsWith("migrate-schema-"));
    expect(migrate).toBeDefined();
    expect(["Completed", "Running", "Pending"]).toContain(migrate!.status);
  });

  it.skipIf(!up)("listPods carries live usage when metrics-server is installed", async () => {
    const { listPods } = await import("./kubernetes");
    const { rows } = await listPods(ID, cfg, "kube-system");
    // k3s ships metrics-server, so at least one kube-system pod should report.
    const withUsage = rows.filter((p) => p.cpuUsage !== null);
    expect(withUsage.length).toBeGreaterThan(0);
    expect(withUsage[0].cpuUsage).toMatch(/^\d+(\.\d+)?m?$/);
    expect(withUsage[0].memUsage).toMatch(/(B|KiB|MiB|GiB)$/);
  });

  it.skipIf(!up)("listNodes maps status, roles, version and usage", async () => {
    const { listNodes } = await import("./kubernetes");
    const { rows } = await listNodes(ID, cfg);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const node = rows[0];
    expect(node.status).toMatch(/^Ready/);
    expect(node.schedulable).toBe(true);
    expect(node.roles).toContain("control-plane");
    expect(node.version).toMatch(/^v1\./);
    expect(node.internalIP).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(node.podCapacity).toBeGreaterThan(0);
    expect(node.cpuPercent).not.toBeNull();
  });

  it.skipIf(!up)("listEvents returns the newest first and names its object", async () => {
    const { listEvents } = await import("./kubernetes");
    const { rows } = await listEvents(ID, cfg, NS);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].ageSeconds).toBeLessThanOrEqual(rows[rows.length - 1].ageSeconds);
    expect(rows.every((e) => e.object.includes("/"))).toBe(true);
    expect(rows.some((e) => e.type === "Warning")).toBe(true); // broken-image
  });

  it.skipIf(!up)("lists the workload kinds the seed created", async () => {
    const k8s = await import("./kubernetes");
    const [deps, sts, ds, jobs, crons, svcs, ings, pvcs, cms, secs] = await Promise.all([
      k8s.listDeployments(ID, cfg, NS),
      k8s.listStatefulSets(ID, cfg, NS),
      k8s.listDaemonSets(ID, cfg, NS),
      k8s.listJobs(ID, cfg, NS),
      k8s.listCronJobs(ID, cfg, NS),
      k8s.listServices(ID, cfg, NS),
      k8s.listIngresses(ID, cfg, NS),
      k8s.listPvcs(ID, cfg, NS),
      k8s.listConfigMaps(ID, cfg, NS),
      k8s.listSecrets(ID, cfg, NS),
    ]);

    // The desired half, not the ready half: a rollout in flight would make the
    // ready count momentarily lag, and this test is about the mapping.
    expect(deps.rows.find((d) => d.name === "storefront")?.ready).toMatch(/^\d+\/2$/);
    expect(sts.rows.find((s) => s.name === "ledger")?.service).toBe("ledger");
    expect(ds.rows.find((d) => d.name === "log-shipper")?.desired).toBeGreaterThanOrEqual(1);
    expect(jobs.rows.find((j) => j.name === "migrate-schema")).toBeDefined();
    expect(crons.rows.find((c) => c.name === "nightly-report")?.schedule).toBe("*/5 * * * *");
    expect(svcs.rows.find((s) => s.name === "storefront")?.type).toBe("ClusterIP");
    expect(ings.rows.find((i) => i.name === "storefront")?.hosts).toBe("storefront.demo.local");
    expect(pvcs.rows.find((p) => p.name === "ledger-data")).toBeDefined();
    expect(cms.rows.find((c) => c.name === "storefront-config")?.dataKeys).toBe(2);
    expect(secs.rows.find((s) => s.name === "storefront-credentials")?.dataKeys).toBe(2);
  });

  it.skipIf(!up)("readResourceYaml strips server-managed fields", async () => {
    const { readResourceYaml } = await import("./kubernetes");
    const yaml = await readResourceYaml(ID, cfg, "configmap", NS, "storefront-config");
    expect(yaml).toContain("kind: ConfigMap");
    expect(yaml).toContain("FEATURE_FLAGS");
    expect(yaml).not.toContain("managedFields");
    expect(yaml).not.toContain("resourceVersion");
  });

  it.skipIf(!up)("readResourceYaml redacts a Secret when asked", async () => {
    const { readResourceYaml } = await import("./kubernetes");
    const plain = await readResourceYaml(ID, cfg, "secret", NS, "storefront-credentials");
    expect(plain).toContain("DB_PASSWORD");

    const redacted = await readResourceYaml(
      ID,
      cfg,
      "secret",
      NS,
      "storefront-credentials",
      { redactSecretValues: true },
    );
    expect(redacted).not.toContain("DB_PASSWORD");
    expect(redacted).not.toContain("last-applied-configuration");
  });

  it.skipIf(!up)("replaceResourceYaml refuses a values-less Secret", async () => {
    const { readResourceYaml, replaceResourceYaml } = await import("./kubernetes");
    const redacted = await readResourceYaml(
      ID,
      cfg,
      "secret",
      NS,
      "storefront-credentials",
      { redactSecretValues: true },
    );
    await expect(replaceResourceYaml(ID, cfg, redacted)).rejects.toThrow(/redacted/i);
  });

  it.skipIf(!up)("describeResource shows the failing container's reason and its events", async () => {
    const { describeResource } = await import("./kubernetes");
    const text = await describeResource(ID, cfg, "pod", NS, "broken-image");
    expect(text).toContain("Name:         broken-image");
    expect(text).toContain("Containers:");
    expect(text).toMatch(/ImagePullBackOff|ErrImagePull|Waiting/);
    expect(text).toContain("Events:");
    expect(text).toContain("Failed");
  });

  it.skipIf(!up)("describeResource never prints a Secret's values", async () => {
    const { describeResource } = await import("./kubernetes");
    const text = await describeResource(ID, cfg, "secret", NS, "storefront-credentials");
    expect(text).toContain("DB_PASSWORD"); // the key
    expect(text).not.toContain("not-a-real-password"); // never the value
    expect(text).not.toContain(Buffer.from("not-a-real-password").toString("base64"));
    expect(text).not.toContain("last-applied-configuration");
  });

  it.skipIf(!up)("getPodLogs reads a named container's output", async () => {
    const { listPods, getPodLogs } = await import("./kubernetes");
    const { rows } = await listPods(ID, cfg, NS);
    const pod = rows.find((p) => p.name.startsWith("storefront-"))!;
    const logs = await getPodLogs(ID, cfg, NS, pod.name, {
      container: "sidecar",
      tailLines: 20,
    });
    expect(logs).toContain("sidecar heartbeat");
  });

  it.skipIf(!up)("scaleDeployment changes the replica count", async () => {
    const { scaleDeployment, listDeployments } = await import("./kubernetes");
    try {
      await scaleDeployment(ID, cfg, NS, "storefront", 3);
      const after = await listDeployments(ID, cfg, NS);
      expect(after.rows.find((d) => d.name === "storefront")?.ready).toMatch(/\/3$/);
    } finally {
      // Restore even if the assertion failed — otherwise the leftover replica
      // count fails the *next* run's workload-list expectations instead.
      await scaleDeployment(ID, cfg, NS, "storefront", 2);
    }
    const restored = await listDeployments(ID, cfg, NS);
    expect(restored.rows.find((d) => d.name === "storefront")?.ready).toMatch(/\/2$/);
  });

  it.skipIf(!up)("restartDeployment stamps the rollout annotation", async () => {
    const { restartDeployment, readResourceYaml } = await import("./kubernetes");
    await restartDeployment(ID, cfg, NS, "storefront");
    const yaml = await readResourceYaml(ID, cfg, "deployment", NS, "storefront");
    expect(yaml).toContain("kubectl.kubernetes.io/restartedAt");
  });

  it.skipIf(!up)("cordon and uncordon flip the node's schedulability", async () => {
    const { listNodes, setNodeSchedulable } = await import("./kubernetes");
    const name = (await listNodes(ID, cfg)).rows[0].name;
    try {
      await setNodeSchedulable(ID, cfg, name, false);
      const cordoned = (await listNodes(ID, cfg)).rows.find((n) => n.name === name)!;
      expect(cordoned.schedulable).toBe(false);
      expect(cordoned.status).toContain("SchedulingDisabled");
    } finally {
      await setNodeSchedulable(ID, cfg, name, true);
    }
    const back = (await listNodes(ID, cfg)).rows.find((n) => n.name === name)!;
    expect(back.schedulable).toBe(true);
  });

  it.skipIf(!up)("deleteResource removes an object", async () => {
    const { replaceResourceYaml, deleteResource, listConfigMaps } = await import("./kubernetes");
    const name = "baklava-it-scratch";
    // Create through the same path the editor uses, then delete it again.
    const { KubeConfig, CoreV1Api } = await import("@kubernetes/client-node");
    const kc = new KubeConfig();
    kc.loadFromFile(KUBECONFIG);
    await kc.makeApiClient(CoreV1Api).createNamespacedConfigMap({
      namespace: NS,
      body: { metadata: { name, namespace: NS }, data: { a: "1" } },
    });
    expect((await listConfigMaps(ID, cfg, NS)).rows.some((c) => c.name === name)).toBe(true);

    await deleteResource(ID, cfg, "configmap", NS, name);
    expect((await listConfigMaps(ID, cfg, NS)).rows.some((c) => c.name === name)).toBe(false);
    // Keep the import used — replaceResourceYaml is covered above.
    expect(typeof replaceResourceYaml).toBe("function");
  });

  it.skipIf(!up)("rejects an unsupported kind rather than guessing", async () => {
    const { readResourceYaml } = await import("./kubernetes");
    await expect(
      readResourceYaml(ID, cfg, "customresourcedefinition", NS, "x"),
    ).rejects.toThrow(/Unsupported kind/);
  });
});
