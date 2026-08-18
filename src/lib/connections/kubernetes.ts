import "server-only";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { Duplex } from "node:stream";
import type {
  KubeConfig,
  CoreV1Api,
  AppsV1Api,
  BatchV1Api,
  NetworkingV1Api,
  VersionApi,
  KubernetesObjectApi,
  Metrics,
  V1Pod,
  V1Deployment,
  V1Service,
  V1ConfigMap,
  V1Secret,
  V1Namespace,
  V1Node,
  KubernetesObject,
} from "@kubernetes/client-node"; // type-only — erased at build, safe when package absent
import type WebSocket from "isomorphic-ws";
import type { KubernetesConfig } from "./types";
import { DriverNotInstalledError } from "@/techs/contract";
import { formatError } from "@/lib/errors";
import { withReplicas, withRestartedAt } from "@/lib/kubernetes/deployment-ops";
import { describeObject } from "@/lib/kubernetes/describe";
import { involvedObjectSelector } from "@/lib/kubernetes/field-selector";
import {
  formatCpu,
  formatMemory as formatMemUsage,
  parseCpu,
  parseMemoryBytes,
} from "@/lib/kubernetes/usage";
import { evictablePods, withUnschedulable } from "@/lib/kubernetes/node-ops";
import { LIST_LIMIT, toList, type K8sList } from "@/lib/kubernetes/list";
import { mapEvent, mapNode } from "@/lib/kubernetes/mappers";
import {
  mapCronJob,
  mapDaemonSet,
  mapIngress,
  mapJob,
  mapPvc,
  mapStatefulSet,
} from "@/lib/kubernetes/workload-mappers";
import type {
  CronJobRow,
  DaemonSetRow,
  EventRow,
  IngressRow,
  JobRow,
  NodeRow,
  PvcRow,
  StatefulSetRow,
} from "@/lib/kubernetes/row-types";

let _k8sMod: typeof import("@kubernetes/client-node") | null = null;
async function getK8s(): Promise<typeof import("@kubernetes/client-node")> {
  try {
    return (_k8sMod ??= await import("@kubernetes/client-node"));
  } catch {
    throw new DriverNotInstalledError("kubernetes", "@kubernetes/client-node");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client cache
//
// Building a KubeConfig parses YAML (possibly reads from disk) and instantiating
// each API class wires a fetch middleware chain. We want each connection to
// pay that cost once. Keyed by connection.id + a structural hash of the config
// so editing the connection invalidates automatically.
// ─────────────────────────────────────────────────────────────────────────────

interface ClientBundle {
  hash: string;
  kc: KubeConfig;
  core: CoreV1Api;
  apps: AppsV1Api;
  batch: BatchV1Api;
  networking: NetworkingV1Api;
  version: VersionApi;
  objects: KubernetesObjectApi;
  metrics: Metrics;
}

const globalKey = Symbol.for("baklava.kubernetesClients");

function getCache(): Map<string, ClientBundle> {
  const g = globalThis as unknown as Record<symbol, Map<string, ClientBundle>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function hashConfig(cfg: KubernetesConfig): string {
  return JSON.stringify([
    cfg.source,
    cfg.kubeconfigPath ?? "",
    cfg.kubeconfigYaml ?? "",
    cfg.context ?? "",
    cfg.namespace ?? "",
  ]);
}

function expandHome(p: string): string {
  if (!p.startsWith("~")) return p;
  return path.join(os.homedir(), p.slice(1));
}

async function buildKubeConfig(cfg: KubernetesConfig): Promise<KubeConfig> {
  const { KubeConfig } = await getK8s();
  const kc = new KubeConfig();
  if (cfg.source === "inline") {
    if (!cfg.kubeconfigYaml?.trim()) {
      throw new Error("Kubeconfig YAML is empty");
    }
    kc.loadFromString(cfg.kubeconfigYaml);
  } else {
    const target = expandHome(cfg.kubeconfigPath?.trim() || "~/.kube/config");
    // loadFromFile reads + parses; throws ENOENT on missing
    kc.loadFromFile(target);
  }
  if (cfg.context?.trim()) {
    kc.setCurrentContext(cfg.context.trim());
  }
  return kc;
}

async function bundleFor(connectionId: string, cfg: KubernetesConfig): Promise<ClientBundle> {
  const cache = getCache();
  const hash = hashConfig(cfg);
  const cached = cache.get(connectionId);
  if (cached && cached.hash === hash) return cached;

  const {
    CoreV1Api,
    AppsV1Api,
    BatchV1Api,
    NetworkingV1Api,
    VersionApi,
    KubernetesObjectApi,
    Metrics,
  } = await getK8s();
  const kc = await buildKubeConfig(cfg);
  const bundle: ClientBundle = {
    hash,
    kc,
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    batch: kc.makeApiClient(BatchV1Api),
    networking: kc.makeApiClient(NetworkingV1Api),
    version: kc.makeApiClient(VersionApi),
    objects: KubernetesObjectApi.makeApiClient(kc),
    metrics: new Metrics(kc),
  };
  cache.set(connectionId, bundle);
  return bundle;
}

/**
 * Drop a cached client bundle. Call on connection delete or update so the
 * next request rebuilds against the latest config.
 */
export function dropKubernetesClient(connectionId: string): void {
  getCache().delete(connectionId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes — mirror src/lib/kubernetes/row-types.ts so existing tables
// require no column changes.
// ─────────────────────────────────────────────────────────────────────────────

export type PodPhase =
  | "Running"
  | "Pending"
  | "Succeeded"
  | "Failed"
  | "Unknown"
  | "Terminating"
  | "CrashLoopBackOff"
  | "ImagePullBackOff"
  | "ContainerCreating"
  | "Init"
  | "Completed"
  | "Error";

export interface PodRow {
  namespace: string;
  name: string;
  ready: string;
  status: PodPhase;
  restarts: number;
  lastRestart?: string;
  ip: string;
  node: string;
  ageSeconds: number;
  cpu: string;
  mem: string;
  qos: "Guaranteed" | "Burstable" | "BestEffort";
  /** Container names, so logs and exec can target one of them. */
  containers: string[];
  /** Live usage from metrics-server; null when it isn't installed. */
  cpuUsage: string | null;
  memUsage: string | null;
}

export interface DeploymentRow {
  namespace: string;
  name: string;
  ready: string;
  upToDate: number;
  available: number;
  ageSeconds: number;
  image: string;
  selector: string;
}

export interface ServiceRow {
  namespace: string;
  name: string;
  type: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName" | "Headless";
  clusterIP: string;
  externalIP: string;
  ports: string;
  ageSeconds: number;
  selector: string;
}

export interface ConfigMapRow {
  namespace: string;
  name: string;
  dataKeys: number;
  ageSeconds: number;
  labels: string;
}

export interface SecretRow {
  namespace: string;
  name: string;
  type:
    | "Opaque"
    | "kubernetes.io/dockerconfigjson"
    | "kubernetes.io/tls"
    | "kubernetes.io/service-account-token";
  dataKeys: number;
  ageSeconds: number;
}

export interface NamespaceRow {
  name: string;
  status: "Active" | "Terminating";
  ageSeconds: number;
  pods: number;
  labels: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping helpers
// ─────────────────────────────────────────────────────────────────────────────

function ageSecondsOf(ts: Date | string | undefined): number {
  if (!ts) return 0;
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  return Number.isFinite(s) && s > 0 ? s : 0;
}

function formatAgo(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function selectorString(selector: Record<string, string> | undefined): string {
  if (!selector) return "<none>";
  const entries = Object.entries(selector);
  if (entries.length === 0) return "<none>";
  return entries.map(([k, v]) => `${k}=${v}`).join(",");
}

function labelsString(labels: Record<string, string> | undefined): string {
  if (!labels) return "<none>";
  const entries = Object.entries(labels);
  if (entries.length === 0) return "<none>";
  // Keep it compact — first 3 labels then ellipsis like kubectl
  if (entries.length <= 3) {
    return entries.map(([k, v]) => `${k}=${v}`).join(",");
  }
  return entries.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(",") + ",…";
}

function podPhase(p: V1Pod): PodPhase {
  // Detect Terminating: pods with a deletionTimestamp.
  if (p.metadata?.deletionTimestamp) return "Terminating";
  const containerStatuses = p.status?.containerStatuses ?? [];
  for (const cs of containerStatuses) {
    const waiting = cs.state?.waiting;
    if (waiting?.reason) {
      const r = waiting.reason;
      if (
        r === "CrashLoopBackOff" ||
        r === "ImagePullBackOff" ||
        r === "ErrImagePull" ||
        r === "ContainerCreating" ||
        r === "CreateContainerConfigError"
      ) {
        return (r === "ErrImagePull" ? "ImagePullBackOff" : r) as PodPhase;
      }
    }
    const terminated = cs.state?.terminated;
    if (terminated?.reason === "Error" || (terminated?.exitCode ?? 0) > 0) {
      return "Error";
    }
  }
  const phase = (p.status?.phase ?? "Unknown") as PodPhase;
  if (phase === "Succeeded") return "Completed";
  return phase;
}

function podReady(p: V1Pod): string {
  const css = p.status?.containerStatuses ?? [];
  const total = css.length || (p.spec?.containers?.length ?? 0);
  const ready = css.filter((cs) => cs.ready).length;
  return `${ready}/${total}`;
}

function podRestarts(p: V1Pod): { count: number; lastRestart?: string } {
  const css = p.status?.containerStatuses ?? [];
  let count = 0;
  let mostRecent: Date | undefined;
  for (const cs of css) {
    count += cs.restartCount ?? 0;
    const t =
      cs.lastState?.terminated?.finishedAt ??
      cs.state?.terminated?.finishedAt;
    if (t) {
      const d = typeof t === "string" ? new Date(t) : t;
      if (!mostRecent || d > mostRecent) mostRecent = d;
    }
  }
  return {
    count,
    lastRestart: mostRecent
      ? formatAgo(ageSecondsOf(mostRecent))
      : undefined,
  };
}

function podQos(p: V1Pod): "Guaranteed" | "Burstable" | "BestEffort" {
  const q = p.status?.qosClass;
  if (q === "Guaranteed" || q === "Burstable" || q === "BestEffort") return q;
  return "BestEffort";
}

function sumRequests(p: V1Pod, key: "cpu" | "memory"): string {
  let total = 0;
  for (const c of p.spec?.containers ?? []) {
    const v = c.resources?.requests?.[key];
    if (typeof v !== "string") continue;
    if (key === "cpu") {
      total += v.endsWith("m") ? Number(v.slice(0, -1)) : Number(v) * 1000;
    } else {
      total += parseMemory(v);
    }
  }
  if (key === "cpu") {
    return total ? `${Math.round(total)}m` : "0m";
  }
  return total ? formatMemory(total) : "0Mi";
}

function parseMemory(v: string): number {
  // Returns bytes
  const m = v.match(/^(\d+(?:\.\d+)?)([KMGTPE]i?)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] ?? "";
  const mult: Record<string, number> = {
    "": 1,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
  };
  return n * (mult[unit] ?? 1);
}

function formatMemory(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}Gi`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}Mi`;
  return `${Math.round(bytes / 1024)}Ki`;
}

function mapPod(p: V1Pod, usage?: { cpu: string; mem: string }): PodRow {
  const restarts = podRestarts(p);
  return {
    namespace: p.metadata?.namespace ?? "default",
    name: p.metadata?.name ?? "",
    ready: podReady(p),
    status: podPhase(p),
    restarts: restarts.count,
    lastRestart: restarts.lastRestart,
    ip: p.status?.podIP ?? "",
    node: p.spec?.nodeName ?? "<unscheduled>",
    ageSeconds: ageSecondsOf(p.metadata?.creationTimestamp),
    cpu: sumRequests(p, "cpu"),
    mem: sumRequests(p, "memory"),
    qos: podQos(p),
    // Init containers included — `kubectl logs -c` accepts them too.
    containers: [
      ...(p.spec?.initContainers ?? []).map((c) => c.name),
      ...(p.spec?.containers ?? []).map((c) => c.name),
    ].filter(Boolean),
    cpuUsage: usage?.cpu ?? null,
    memUsage: usage?.mem ?? null,
  };
}

function mapDeployment(d: V1Deployment): DeploymentRow {
  const desired = d.spec?.replicas ?? 0;
  const ready = d.status?.readyReplicas ?? 0;
  const containers = d.spec?.template?.spec?.containers ?? [];
  return {
    namespace: d.metadata?.namespace ?? "default",
    name: d.metadata?.name ?? "",
    ready: `${ready}/${desired}`,
    upToDate: d.status?.updatedReplicas ?? 0,
    available: d.status?.availableReplicas ?? 0,
    ageSeconds: ageSecondsOf(d.metadata?.creationTimestamp),
    image: containers[0]?.image ?? "—",
    selector: selectorString(d.spec?.selector?.matchLabels),
  };
}

function mapService(s: V1Service): ServiceRow {
  const t = s.spec?.type ?? "ClusterIP";
  const isHeadless =
    t === "ClusterIP" && (s.spec?.clusterIP === "None" || !s.spec?.clusterIP);
  const ports = (s.spec?.ports ?? [])
    .map((p) => {
      const np = p.nodePort ? `:${p.nodePort}` : "";
      return `${p.port}${np}/${p.protocol ?? "TCP"}`;
    })
    .join(",") || "<none>";
  const externalIPs = (() => {
    if (t === "LoadBalancer") {
      const ing = s.status?.loadBalancer?.ingress ?? [];
      const list = ing
        .map((i) => i.hostname || i.ip)
        .filter((x): x is string => !!x);
      if (list.length) return list.join(",");
      return "<pending>";
    }
    if (s.spec?.externalIPs?.length) return s.spec.externalIPs.join(",");
    if (t === "ExternalName") return s.spec?.externalName ?? "<none>";
    return "<none>";
  })();
  return {
    namespace: s.metadata?.namespace ?? "default",
    name: s.metadata?.name ?? "",
    type: isHeadless ? "Headless" : (t as ServiceRow["type"]),
    clusterIP: s.spec?.clusterIP || "None",
    externalIP: externalIPs,
    ports,
    ageSeconds: ageSecondsOf(s.metadata?.creationTimestamp),
    selector: selectorString(s.spec?.selector),
  };
}

function mapConfigMap(c: V1ConfigMap): ConfigMapRow {
  const data = Object.keys(c.data ?? {}).length + Object.keys(c.binaryData ?? {}).length;
  return {
    namespace: c.metadata?.namespace ?? "default",
    name: c.metadata?.name ?? "",
    dataKeys: data,
    ageSeconds: ageSecondsOf(c.metadata?.creationTimestamp),
    labels: labelsString(c.metadata?.labels),
  };
}

function mapSecret(s: V1Secret): SecretRow {
  const data = Object.keys(s.data ?? {}).length + Object.keys(s.stringData ?? {}).length;
  return {
    namespace: s.metadata?.namespace ?? "default",
    name: s.metadata?.name ?? "",
    type: (s.type as SecretRow["type"]) ?? "Opaque",
    dataKeys: data,
    ageSeconds: ageSecondsOf(s.metadata?.creationTimestamp),
  };
}

function mapNamespace(n: V1Namespace, podCounts: Map<string, number>): NamespaceRow {
  const name = n.metadata?.name ?? "";
  return {
    name,
    status: (n.status?.phase as "Active" | "Terminating") ?? "Active",
    ageSeconds: ageSecondsOf(n.metadata?.creationTimestamp),
    pods: podCounts.get(name) ?? 0,
    labels: labelsString(n.metadata?.labels),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe + listers
// ─────────────────────────────────────────────────────────────────────────────

export interface Probe {
  context: string;
  serverVersion: string;
  nodeCount: number;
}

export async function probe(
  connectionId: string,
  cfg: KubernetesConfig,
): Promise<Probe> {
  const b = await bundleFor(connectionId, cfg);
  const [version, nodes] = await Promise.all([
    b.version.getCode().catch(() => null),
    b.core.listNode().catch<{ items: V1Node[] }>(() => ({ items: [] })),
  ]);
  return {
    context: b.kc.currentContext || cfg.context || "current-context",
    serverVersion: version?.gitVersion || "unknown",
    nodeCount: nodes.items.length,
  };
}

export async function listNamespaces(
  connectionId: string,
  cfg: KubernetesConfig,
): Promise<K8sList<NamespaceRow>> {
  const b = await bundleFor(connectionId, cfg);
  const [nsList, podList] = await Promise.all([
    b.core.listNamespace({ limit: LIST_LIMIT }),
    // Only used for the per-namespace pod count. A namespace-scoped kubeconfig
    // is forbidden from listing pods cluster-wide, and losing a count column is
    // no reason to fail the whole page. Bounded like every other list — the
    // count is a hint, not an audit.
    b.core
      .listPodForAllNamespaces({ limit: LIST_LIMIT })
      .catch<{ items: V1Pod[] }>(() => ({ items: [] })),
  ]);
  const counts = new Map<string, number>();
  for (const p of podList.items) {
    const ns = p.metadata?.namespace ?? "default";
    counts.set(ns, (counts.get(ns) ?? 0) + 1);
  }
  return toList(nsList, (n) => mapNamespace(n, counts));
}

export async function listStatefulSets(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<StatefulSetRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.apps.listNamespacedStatefulSet({ namespace, limit: LIST_LIMIT })
      : await b.apps.listStatefulSetForAllNamespaces({ limit: LIST_LIMIT });
  const now = new Date();
  return toList(list, (o) => mapStatefulSet(o, now));
}

export async function listDaemonSets(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<DaemonSetRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.apps.listNamespacedDaemonSet({ namespace, limit: LIST_LIMIT })
      : await b.apps.listDaemonSetForAllNamespaces({ limit: LIST_LIMIT });
  const now = new Date();
  return toList(list, (o) => mapDaemonSet(o, now));
}

export async function listJobs(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<JobRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.batch.listNamespacedJob({ namespace, limit: LIST_LIMIT })
      : await b.batch.listJobForAllNamespaces({ limit: LIST_LIMIT });
  const now = new Date();
  return toList(list, (o) => mapJob(o, now));
}

export async function listCronJobs(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<CronJobRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.batch.listNamespacedCronJob({ namespace, limit: LIST_LIMIT })
      : await b.batch.listCronJobForAllNamespaces({ limit: LIST_LIMIT });
  const now = new Date();
  return toList(list, (o) => mapCronJob(o, now));
}

export async function listIngresses(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<IngressRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.networking.listNamespacedIngress({ namespace, limit: LIST_LIMIT })
      : await b.networking.listIngressForAllNamespaces({ limit: LIST_LIMIT });
  const now = new Date();
  return toList(list, (o) => mapIngress(o, now));
}

export async function listPvcs(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<PvcRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedPersistentVolumeClaim({ namespace, limit: LIST_LIMIT })
      : await b.core.listPersistentVolumeClaimForAllNamespaces({ limit: LIST_LIMIT });
  const now = new Date();
  return toList(list, (o) => mapPvc(o, now));
}

/**
 * Live usage per object, keyed by "namespace/name" (pods) or name (nodes).
 * metrics-server is an add-on: when it isn't installed the call 404s, and the
 * tables simply show no usage rather than the page failing.
 */
async function podUsage(
  b: ClientBundle,
): Promise<Map<string, { cpu: string; mem: string }>> {
  const out = new Map<string, { cpu: string; mem: string }>();
  const metrics = await b.metrics.getPodMetrics().catch(() => null);
  for (const p of metrics?.items ?? []) {
    // A pod's usage is the sum over its containers, like `kubectl top pod`.
    let cpu = 0;
    let mem = 0;
    for (const c of p.containers ?? []) {
      cpu += parseCpu(c.usage?.cpu) ?? 0;
      mem += parseMemoryBytes(c.usage?.memory) ?? 0;
    }
    out.set(`${p.metadata?.namespace ?? "default"}/${p.metadata?.name ?? ""}`, {
      cpu: formatCpu(cpu),
      mem: formatMemUsage(mem),
    });
  }
  return out;
}

export async function listNodes(
  connectionId: string,
  cfg: KubernetesConfig,
): Promise<K8sList<NodeRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list = await b.core.listNode({ limit: LIST_LIMIT });
  const metrics = await b.metrics.getNodeMetrics().catch(() => null);
  const usage = new Map(
    (metrics?.items ?? []).map((m) => [m.metadata?.name ?? "", m.usage]),
  );
  const now = new Date();
  return toList(list, (n) => mapNode(n, now, usage.get(n.metadata?.name ?? "")));
}

export async function listEvents(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<EventRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedEvent({ namespace, limit: LIST_LIMIT })
      : await b.core.listEventForAllNamespaces({ limit: LIST_LIMIT });
  const now = new Date();
  const out = toList(list, (e) => mapEvent(e, now));
  // Newest first — an event list is read from the top.
  out.rows.sort((a, z) => a.ageSeconds - z.ageSeconds);
  return out;
}

export async function listPods(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<PodRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedPod({ namespace, limit: LIST_LIMIT })
      : await b.core.listPodForAllNamespaces({ limit: LIST_LIMIT });
  const usage = await podUsage(b);
  return toList(list, (o) =>
    mapPod(o, usage.get(`${o.metadata?.namespace ?? "default"}/${o.metadata?.name ?? ""}`)),
  );
}

export async function listDeployments(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<DeploymentRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.apps.listNamespacedDeployment({ namespace, limit: LIST_LIMIT })
      : await b.apps.listDeploymentForAllNamespaces({ limit: LIST_LIMIT });
  return toList(list, (o) => mapDeployment(o));
}

export async function listServices(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<ServiceRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedService({ namespace, limit: LIST_LIMIT })
      : await b.core.listServiceForAllNamespaces({ limit: LIST_LIMIT });
  return toList(list, (o) => mapService(o));
}

export async function listConfigMaps(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<ConfigMapRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedConfigMap({ namespace, limit: LIST_LIMIT })
      : await b.core.listConfigMapForAllNamespaces({ limit: LIST_LIMIT });
  return toList(list, (o) => mapConfigMap(o));
}

export async function listSecrets(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<K8sList<SecretRow>> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedSecret({ namespace, limit: LIST_LIMIT })
      : await b.core.listSecretForAllNamespaces({ limit: LIST_LIMIT });
  return toList(list, (o) => mapSecret(o));
}

// ─────────────────────────────────────────────────────────────────────────────
// Log streaming
// ─────────────────────────────────────────────────────────────────────────────

export interface LogStream {
  /** Node Writable readable side — pipe into your SSE encoder. */
  output: PassThrough;
  /** Call to stop the underlying API request. */
  abort: () => void;
}

export async function streamPodLogs(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  podName: string,
  options: { follow?: boolean; tailLines?: number; container?: string } = {},
): Promise<LogStream> {
  const { Log } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  const log = new Log(b.kc);
  const output = new PassThrough();
  const controller = await log.log(
    namespace,
    podName,
    options.container ?? "",
    output,
    {
      follow: options.follow ?? true,
      tailLines: options.tailLines ?? 200,
      timestamps: false,
      pretty: false,
    },
  );
  return {
    output,
    abort: () => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
      try {
        output.destroy();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * One-shot, non-following pod logs (tail-bounded, byte-capped) for the AI tool.
 * Returns at most ~200 KB of the most recent `tailLines` lines. Times out at 30s.
 */
export async function getPodLogs(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  podName: string,
  options: { tailLines?: number; container?: string } = {},
): Promise<string> {
  const { Log } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  const log = new Log(b.kc);
  const output = new PassThrough();
  const MAX_BYTES = 200_000;
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let controller: { abort: () => void } | undefined;
    const timer = setTimeout(
      () => fail(new Error("Timed out reading pod logs")),
      30_000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      try {
        controller?.abort();
      } catch {
        // ignore
      }
      try {
        output.destroy();
      } catch {
        // ignore
      }
    };
    function done(s: string) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(s);
    }
    function fail(e: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e);
    }
    output.on("data", (c: Buffer) => {
      if (total < MAX_BYTES) {
        chunks.push(c);
        total += c.length;
      }
    });
    output.on("end", () =>
      done(Buffer.concat(chunks).toString("utf8").slice(0, MAX_BYTES)),
    );
    output.on("error", fail);
    log
      .log(namespace, podName, options.container ?? "", output, {
        follow: false,
        tailLines: Math.min(Math.max(options.tailLines ?? 200, 1), 2000),
        limitBytes: MAX_BYTES,
        timestamps: false,
        pretty: false,
      })
      .then((c) => {
        controller = c as { abort: () => void };
      })
      .catch(fail);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exec (interactive shell)
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecSession {
  /** stdin from client → pod */
  stdin: PassThrough;
  /** combined stdout+stderr from pod → SSE (Duplex so we can listen to "data") */
  output: Duplex;
  /** Active websocket, kept so callers can resize/close. */
  ws: WebSocket;
  /** Tear down the websocket + both streams. */
  close: () => void;
}

class CombinedWritable extends Writable {
  constructor(private target: PassThrough, private tag: "stdout" | "stderr") {
    super();
  }
  _write(
    chunk: Buffer | string,
    enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    const buf =
      typeof chunk === "string" ? Buffer.from(chunk, enc) : (chunk as Buffer);
    // Wrap stderr lines so the client can color them if it wants. We keep the
    // separator minimal — clients that don't care just see the raw bytes.
    if (this.tag === "stderr" && buf.length > 0) {
      // Prepend ANSI bold-red SGR for visibility in the xterm-style overlay.
      const prefix = Buffer.from("[31m");
      const suffix = Buffer.from("[0m");
      this.target.write(Buffer.concat([prefix, buf, suffix]));
    } else {
      this.target.write(buf);
    }
    cb();
  }
}

export async function startExec(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  podName: string,
  command: string[] = ["/bin/sh"],
  container?: string,
): Promise<ExecSession> {
  const { Exec } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  const exec = new Exec(b.kc);
  const stdin = new PassThrough();
  const output = new PassThrough();
  const stdout = new CombinedWritable(output, "stdout");
  const stderr = new CombinedWritable(output, "stderr");
  const ws = await exec.exec(
    namespace,
    podName,
    container ?? "",
    command,
    stdout,
    stderr,
    stdin,
    true, // tty
    (status) => {
      // status.status === "Success" | "Failure"
      const note = status.message
        ? `\r\n[session ended: ${status.message}]\r\n`
        : "\r\n[session ended]\r\n";
      output.write(Buffer.from(note));
      output.end();
    },
  );
  return {
    stdin,
    output,
    ws,
    close: () => {
      try {
        stdin.end();
      } catch {
        // ignore
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
      try {
        output.end();
      } catch {
        // ignore
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// YAML get / replace
// ─────────────────────────────────────────────────────────────────────────────

/**
 * apiVersion + kind for the resource kinds the workspace knows how to edit.
 * The key is the URL-friendly singular our routes accept.
 */
const KIND_MAP: Record<
  string,
  { apiVersion: string; kind: string; namespaced: boolean }
> = {
  pod: { apiVersion: "v1", kind: "Pod", namespaced: true },
  deployment: { apiVersion: "apps/v1", kind: "Deployment", namespaced: true },
  service: { apiVersion: "v1", kind: "Service", namespaced: true },
  configmap: { apiVersion: "v1", kind: "ConfigMap", namespaced: true },
  secret: { apiVersion: "v1", kind: "Secret", namespaced: true },
  namespace: { apiVersion: "v1", kind: "Namespace", namespaced: false },
  node: { apiVersion: "v1", kind: "Node", namespaced: false },
  statefulset: { apiVersion: "apps/v1", kind: "StatefulSet", namespaced: true },
  daemonset: { apiVersion: "apps/v1", kind: "DaemonSet", namespaced: true },
  job: { apiVersion: "batch/v1", kind: "Job", namespaced: true },
  cronjob: { apiVersion: "batch/v1", kind: "CronJob", namespaced: true },
  ingress: { apiVersion: "networking.k8s.io/v1", kind: "Ingress", namespaced: true },
  persistentvolumeclaim: {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    namespaced: true,
  },
  event: { apiVersion: "v1", kind: "Event", namespaced: true },
};

export function resolveKind(kind: string): {
  apiVersion: string;
  kind: string;
  namespaced: boolean;
} {
  const k = KIND_MAP[kind.toLowerCase()];
  if (!k) throw new Error(`Unsupported kind: ${kind}`);
  return k;
}

/** Strip server-managed fields so the editable buffer is clean. */
function sanitizeForEdit(obj: KubernetesObject): KubernetesObject {
  const o = obj as KubernetesObject & {
    metadata?: Record<string, unknown>;
    status?: unknown;
  };
  if (o.metadata && typeof o.metadata === "object") {
    delete o.metadata.managedFields;
    delete o.metadata.creationTimestamp;
    delete o.metadata.resourceVersion;
    delete o.metadata.generation;
    delete o.metadata.uid;
    delete o.metadata.selfLink;
  }
  delete o.status;
  return o;
}

/**
 * Fetch a Kubernetes resource and return it as a YAML string, with
 * server-managed fields stripped so the buffer is clean for editing.
 * When `opts.redactSecretValues` is set, a Secret's `data`/`stringData` are
 * stripped — the result is for display only and MUST NOT be passed back to
 * `replaceResourceYaml` (re-applying it would wipe the Secret's values).
 */
export async function readResourceYaml(
  connectionId: string,
  cfg: KubernetesConfig,
  kind: string,
  namespace: string | undefined,
  name: string,
  opts: { redactSecretValues?: boolean } = {},
): Promise<string> {
  const { dumpYaml } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  const k = resolveKind(kind);
  const spec = {
    apiVersion: k.apiVersion,
    kind: k.kind,
    metadata: { name, namespace: k.namespaced ? namespace : undefined },
  };
  const obj = await b.objects.read(spec);
  const clean = sanitizeForEdit(obj) as Record<string, unknown>;
  if (opts.redactSecretValues && k.kind === "Secret") {
    delete clean.data;
    delete clean.stringData;
    // `kubectl apply` mirrors the entire manifest — including the base64
    // `data` — into this annotation, so it must be stripped too or the
    // redaction leaks the secret values it just removed.
    const meta = clean.metadata as
      | { annotations?: Record<string, unknown> }
      | undefined;
    if (meta?.annotations) {
      delete meta.annotations["kubectl.kubernetes.io/last-applied-configuration"];
    }
  }
  return dumpYaml(clean);
}

/**
 * `kubectl describe`-style text for one object: the live manifest plus the
 * events that name it. Events are best-effort — a kubeconfig may be allowed
 * to read the object but not the namespace's events, and losing the event
 * tail is no reason to fail the whole describe.
 */
export async function describeResource(
  connectionId: string,
  cfg: KubernetesConfig,
  kind: string,
  namespace: string | undefined,
  name: string,
): Promise<string> {
  const b = await bundleFor(connectionId, cfg);
  const k = resolveKind(kind);
  const obj = await b.objects.read({
    apiVersion: k.apiVersion,
    kind: k.kind,
    metadata: { name, namespace: k.namespaced ? namespace : undefined },
  });
  // fieldSelector keeps this to the object's own events rather than the whole
  // namespace's — kubectl describe does the same. The builder validates the
  // name so it can't append selector terms of its own.
  const fieldSelector = involvedObjectSelector(k.kind, name);
  const events = await (k.namespaced && namespace
    ? b.core.listNamespacedEvent({ namespace, fieldSelector })
    : b.core.listEventForAllNamespaces({ fieldSelector })
  ).catch(() => ({ items: [] }));
  const now = new Date();
  return describeObject(
    obj,
    events.items.map((e) => mapEvent(e, now)),
    now,
  );
}

export async function replaceResourceYaml(
  connectionId: string,
  cfg: KubernetesConfig,
  yaml: string,
): Promise<void> {
  const { loadYaml } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  const parsed = loadYaml<KubernetesObject>(yaml);
  if (!parsed?.kind || !parsed?.apiVersion) {
    throw new Error("YAML missing kind/apiVersion");
  }
  // A full replace with no values would wipe the Secret. The redacted view
  // from readResourceYaml has exactly this shape, so refuse it rather than
  // silently erasing every key on apply.
  if (parsed.kind === "Secret") {
    const s = parsed as KubernetesObject & {
      data?: Record<string, unknown>;
      stringData?: Record<string, unknown>;
    };
    const hasData = s.data && Object.keys(s.data).length > 0;
    const hasStringData = s.stringData && Object.keys(s.stringData).length > 0;
    if (!hasData && !hasStringData) {
      throw new Error(
        "Refusing to replace a Secret that has no data/stringData — this looks like a redacted view, and applying it would wipe the Secret's values.",
      );
    }
  }
  // replace requires the latest resourceVersion — fetch it fresh so the
  // user doesn't have to keep it in their buffer.
  const current = await b.objects.read({
    apiVersion: parsed.apiVersion,
    kind: parsed.kind,
    metadata: {
      name: parsed.metadata?.name ?? "",
      namespace: parsed.metadata?.namespace,
    },
  });
  const merged: KubernetesObject = {
    ...parsed,
    metadata: {
      ...(parsed.metadata ?? {}),
      resourceVersion: current.metadata?.resourceVersion,
    },
  };
  await b.objects.replace(merged);
}

/**
 * Set a Deployment's replica count.
 *
 * A strategic-merge PATCH, not read-modify-replace: a Deployment's `status` is
 * rewritten continuously by its controller, so a replace races with it and
 * loses with a 409 whenever the deployment is actively reconciling — which is
 * exactly when you are scaling it. `kubectl scale` patches for the same reason.
 */
export async function scaleDeployment(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
  replicas: number,
): Promise<void> {
  const { PatchStrategy } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  await b.objects.patch(
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name, namespace },
      ...withReplicas({}, replicas),
    } as KubernetesObject,
    undefined,
    undefined,
    undefined,
    undefined,
    PatchStrategy.StrategicMergePatch,
  );
}

/**
 * Roll a Deployment's pods the way `kubectl rollout restart` does — by
 * stamping the restart annotation on the pod template. Patched, not replaced,
 * for the same reason as scaling.
 */
export async function restartDeployment(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
): Promise<void> {
  const { PatchStrategy } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  await b.objects.patch(
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name, namespace },
      ...withRestartedAt({}, new Date().toISOString()),
    } as KubernetesObject,
    undefined,
    undefined,
    undefined,
    undefined,
    PatchStrategy.StrategicMergePatch,
  );
}

/**
 * Cordon or uncordon a node — `kubectl cordon` / `kubectl uncordon`. Patched
 * rather than replaced: the kubelet rewrites a node's status constantly, so a
 * replace would lose the race.
 */
export async function setNodeSchedulable(
  connectionId: string,
  cfg: KubernetesConfig,
  name: string,
  schedulable: boolean,
): Promise<void> {
  const { PatchStrategy } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  await b.objects.patch(
    {
      apiVersion: "v1",
      kind: "Node",
      metadata: { name },
      ...withUnschedulable({}, !schedulable),
    } as KubernetesObject,
    undefined,
    undefined,
    undefined,
    undefined,
    PatchStrategy.StrategicMergePatch,
  );
}

export interface DrainResult {
  cordoned: boolean;
  evicted: number;
  /** Pods eviction refused, usually because of a PodDisruptionBudget. */
  failures: Array<{ pod: string; error: string }>;
}

/**
 * `kubectl drain`: cordon first so nothing new lands, then evict the pods that
 * can be evicted. Eviction (not delete) is what respects PodDisruptionBudgets,
 * so a refusal is a real answer — it's reported, not swallowed.
 */
export async function drainNode(
  connectionId: string,
  cfg: KubernetesConfig,
  name: string,
): Promise<DrainResult> {
  const b = await bundleFor(connectionId, cfg);
  await setNodeSchedulable(connectionId, cfg, name, false);

  const pods = await b.core.listPodForAllNamespaces({
    fieldSelector: `spec.nodeName=${name}`,
    limit: LIST_LIMIT,
  });
  const targets = evictablePods(pods.items, name);
  const failures: DrainResult["failures"] = [];
  let evicted = 0;
  for (const t of targets) {
    try {
      await b.core.createNamespacedPodEviction({
        namespace: t.namespace,
        name: t.name,
        body: {
          apiVersion: "policy/v1",
          kind: "Eviction",
          metadata: { name: t.name, namespace: t.namespace },
        },
      });
      evicted += 1;
    } catch (err) {
      failures.push({ pod: `${t.namespace}/${t.name}`, error: formatError(err) });
    }
  }
  return { cordoned: true, evicted, failures };
}

export async function deleteResource(
  connectionId: string,
  cfg: KubernetesConfig,
  kind: string,
  namespace: string | undefined,
  name: string,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  const k = resolveKind(kind);
  await b.objects.delete({
    apiVersion: k.apiVersion,
    kind: k.kind,
    metadata: { name, namespace: k.namespaced ? namespace : undefined },
  });
}
