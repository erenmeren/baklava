import "server-only";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { Duplex } from "node:stream";
import type {
  KubeConfig,
  CoreV1Api,
  AppsV1Api,
  VersionApi,
  KubernetesObjectApi,
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
import { withReplicas, withRestartedAt } from "@/lib/kubernetes/deployment-ops";

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
  version: VersionApi;
  objects: KubernetesObjectApi;
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

  const { CoreV1Api, AppsV1Api, VersionApi, KubernetesObjectApi } = await getK8s();
  const kc = await buildKubeConfig(cfg);
  const bundle: ClientBundle = {
    hash,
    kc,
    core: kc.makeApiClient(CoreV1Api),
    apps: kc.makeApiClient(AppsV1Api),
    version: kc.makeApiClient(VersionApi),
    objects: KubernetesObjectApi.makeApiClient(kc),
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

function mapPod(p: V1Pod): PodRow {
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
): Promise<NamespaceRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const [nsList, podList] = await Promise.all([
    b.core.listNamespace(),
    // Only used for the per-namespace pod count. A namespace-scoped kubeconfig
    // is forbidden from listing pods cluster-wide, and losing a count column is
    // no reason to fail the whole page.
    b.core.listPodForAllNamespaces().catch<{ items: V1Pod[] }>(() => ({ items: [] })),
  ]);
  const counts = new Map<string, number>();
  for (const p of podList.items) {
    const ns = p.metadata?.namespace ?? "default";
    counts.set(ns, (counts.get(ns) ?? 0) + 1);
  }
  return nsList.items.map((n) => mapNamespace(n, counts));
}

export async function listPods(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<PodRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedPod({ namespace })
      : await b.core.listPodForAllNamespaces();
  return list.items.map(mapPod);
}

export async function listDeployments(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<DeploymentRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.apps.listNamespacedDeployment({ namespace })
      : await b.apps.listDeploymentForAllNamespaces();
  return list.items.map(mapDeployment);
}

export async function listServices(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<ServiceRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedService({ namespace })
      : await b.core.listServiceForAllNamespaces();
  return list.items.map(mapService);
}

export async function listConfigMaps(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<ConfigMapRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedConfigMap({ namespace })
      : await b.core.listConfigMapForAllNamespaces();
  return list.items.map(mapConfigMap);
}

export async function listSecrets(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace?: string,
): Promise<SecretRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const list =
    namespace && namespace !== "*"
      ? await b.core.listNamespacedSecret({ namespace })
      : await b.core.listSecretForAllNamespaces();
  return list.items.map(mapSecret);
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
 * Set a Deployment's replica count. Read-modify-replace through
 * KubernetesObjectApi rather than the scale subresource so it goes down the
 * same proven path as the YAML editor.
 */
export async function scaleDeployment(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
  replicas: number,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  const spec = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace },
  };
  const current = await b.objects.read(spec);
  await b.objects.replace(withReplicas(current, replicas) as KubernetesObject);
}

/**
 * Roll a Deployment's pods the way `kubectl rollout restart` does — by
 * stamping the restart annotation on the pod template.
 */
export async function restartDeployment(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  const spec = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace },
  };
  const current = await b.objects.read(spec);
  await b.objects.replace(
    withRestartedAt(current, new Date().toISOString()) as KubernetesObject,
  );
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
