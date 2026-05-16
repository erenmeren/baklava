import {
  CoreV1Api,
  KubeConfig,
  type V1Pod,
  type V1PodCondition,
  type V1Node,
  type V1Namespace,
  type V1ContainerStatus,
} from "@kubernetes/client-node";
import type { KubernetesConfig } from "./types";

/**
 * Build a configured CoreV1Api client from a KubernetesConfig.
 *
 * The kubeconfig text is loaded via KubeConfig.loadFromString — this keeps
 * everything in-memory; we never write the kubeconfig to disk. The optional
 * `context` field selects a non-default context within the kubeconfig.
 */
function buildClient(config: KubernetesConfig): {
  kc: KubeConfig;
  core: CoreV1Api;
} {
  const kc = new KubeConfig();
  kc.loadFromString(config.kubeconfig);
  if (config.context) {
    kc.setCurrentContext(config.context);
  }
  const core = kc.makeApiClient(CoreV1Api);
  return { kc, core };
}

export interface KubernetesProbeResult {
  context: string;
  cluster: string;
  apiServer: string;
  namespaceCount: number;
  nodeCount: number;
}

/** Cheap reachability check — list namespaces and nodes. */
export async function probeKubernetes(
  config: KubernetesConfig
): Promise<KubernetesProbeResult> {
  const { kc, core } = buildClient(config);
  const [namespaces, nodes] = await Promise.all([
    core.listNamespace(),
    core.listNode(),
  ]);
  const ctx = kc.getCurrentContext();
  const cluster =
    kc.getContextObject(ctx)?.cluster ?? kc.getCurrentCluster()?.name ?? "—";
  const apiServer = kc.getCurrentCluster()?.server ?? "—";
  return {
    context: ctx,
    cluster,
    apiServer,
    namespaceCount: namespaces.items.length,
    nodeCount: nodes.items.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview
// ─────────────────────────────────────────────────────────────────────────────

export interface KubernetesOverview {
  context: string;
  cluster: string;
  apiServer: string;
  nodes: {
    name: string;
    ready: boolean;
    roles: string[];
    kubeletVersion: string;
    osImage: string;
    architecture: string;
    cpuCapacity: string;
    memoryCapacity: string;
    creationTimestamp: string | null;
  }[];
  namespaceCount: number;
  podCount: number;
  podPhases: Record<string, number>;
  topNamespacesByPods: { name: string; pods: number }[];
}

function nodeReady(node: V1Node): boolean {
  return (
    node.status?.conditions?.find((c) => c.type === "Ready")?.status === "True"
  );
}

function nodeRoles(node: V1Node): string[] {
  const labels = node.metadata?.labels ?? {};
  const roles: string[] = [];
  for (const k of Object.keys(labels)) {
    if (k.startsWith("node-role.kubernetes.io/")) {
      const role = k.slice("node-role.kubernetes.io/".length);
      if (role) roles.push(role);
    }
  }
  return roles.length ? roles : ["worker"];
}

export async function getKubernetesOverview(
  config: KubernetesConfig
): Promise<KubernetesOverview> {
  const { kc, core } = buildClient(config);
  const [namespaces, nodes, pods] = await Promise.all([
    core.listNamespace(),
    core.listNode(),
    core.listPodForAllNamespaces(),
  ]);

  const podPhases: Record<string, number> = {};
  const podsByNs = new Map<string, number>();
  for (const p of pods.items) {
    const phase = p.status?.phase ?? "Unknown";
    podPhases[phase] = (podPhases[phase] ?? 0) + 1;
    const ns = p.metadata?.namespace ?? "default";
    podsByNs.set(ns, (podsByNs.get(ns) ?? 0) + 1);
  }
  const topNamespacesByPods = [...podsByNs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, pods]) => ({ name, pods }));

  const ctx = kc.getCurrentContext();
  return {
    context: ctx,
    cluster:
      kc.getContextObject(ctx)?.cluster ?? kc.getCurrentCluster()?.name ?? "—",
    apiServer: kc.getCurrentCluster()?.server ?? "—",
    nodes: nodes.items.map((n) => ({
      name: n.metadata?.name ?? "—",
      ready: nodeReady(n),
      roles: nodeRoles(n),
      kubeletVersion: n.status?.nodeInfo?.kubeletVersion ?? "—",
      osImage: n.status?.nodeInfo?.osImage ?? "—",
      architecture: n.status?.nodeInfo?.architecture ?? "—",
      cpuCapacity: n.status?.capacity?.cpu ?? "—",
      memoryCapacity: n.status?.capacity?.memory ?? "—",
      creationTimestamp:
        n.metadata?.creationTimestamp instanceof Date
          ? n.metadata.creationTimestamp.toISOString()
          : (n.metadata?.creationTimestamp as string | undefined) ?? null,
    })),
    namespaceCount: namespaces.items.length,
    podCount: pods.items.length,
    podPhases,
    topNamespacesByPods,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pods (primary browse)
// ─────────────────────────────────────────────────────────────────────────────

export interface PodSummary {
  name: string;
  namespace: string;
  phase: string;
  ready: string; // e.g. "2/3"
  readyAll: boolean;
  restarts: number;
  containers: number;
  podIp: string | null;
  nodeName: string | null;
  createdAt: string | null;
  /** Lifecycle of the pod inferred from conditions — used for the UI's color toning. */
  state: "running" | "pending" | "succeeded" | "failed" | "unknown";
}

function classifyPod(pod: V1Pod): PodSummary["state"] {
  const phase = pod.status?.phase;
  if (phase === "Running") return "running";
  if (phase === "Pending") return "pending";
  if (phase === "Succeeded") return "succeeded";
  if (phase === "Failed") return "failed";
  return "unknown";
}

function readyTotal(statuses?: V1ContainerStatus[]): {
  ready: number;
  total: number;
  restarts: number;
} {
  if (!statuses) return { ready: 0, total: 0, restarts: 0 };
  let ready = 0;
  let restarts = 0;
  for (const s of statuses) {
    if (s.ready) ready += 1;
    restarts += s.restartCount ?? 0;
  }
  return { ready, total: statuses.length, restarts };
}

export async function listPods(
  config: KubernetesConfig,
  namespace?: string
): Promise<PodSummary[]> {
  const { core } = buildClient(config);
  const res = namespace
    ? await core.listNamespacedPod({ namespace })
    : await core.listPodForAllNamespaces();
  return res.items
    .map((p) => {
      const { ready, total, restarts } = readyTotal(
        p.status?.containerStatuses
      );
      return {
        name: p.metadata?.name ?? "—",
        namespace: p.metadata?.namespace ?? "default",
        phase: p.status?.phase ?? "Unknown",
        ready: `${ready}/${total}`,
        readyAll: total > 0 && ready === total,
        restarts,
        containers: total,
        podIp: p.status?.podIP ?? null,
        nodeName: p.spec?.nodeName ?? null,
        createdAt:
          p.metadata?.creationTimestamp instanceof Date
            ? p.metadata.creationTimestamp.toISOString()
            : (p.metadata?.creationTimestamp as string | undefined) ?? null,
        state: classifyPod(p),
      };
    })
    .sort((a, b) => {
      if (a.namespace !== b.namespace) {
        return a.namespace.localeCompare(b.namespace);
      }
      return a.name.localeCompare(b.name);
    });
}

export async function listNamespaces(
  config: KubernetesConfig
): Promise<{ name: string; phase: string; createdAt: string | null }[]> {
  const { core } = buildClient(config);
  const res = await core.listNamespace();
  return res.items
    .map((n: V1Namespace) => ({
      name: n.metadata?.name ?? "—",
      phase: n.status?.phase ?? "Active",
      createdAt:
        n.metadata?.creationTimestamp instanceof Date
          ? n.metadata.creationTimestamp.toISOString()
          : (n.metadata?.creationTimestamp as string | undefined) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pod detail
// ─────────────────────────────────────────────────────────────────────────────

export interface PodDetail {
  name: string;
  namespace: string;
  phase: string;
  state: PodSummary["state"];
  podIp: string | null;
  hostIp: string | null;
  nodeName: string | null;
  serviceAccount: string | null;
  qosClass: string | null;
  createdAt: string | null;
  startTime: string | null;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  conditions: { type: string; status: string; reason?: string; message?: string; lastTransitionTime: string | null }[];
  containers: {
    name: string;
    image: string;
    ready: boolean;
    restartCount: number;
    state: "running" | "waiting" | "terminated" | "unknown";
    stateReason?: string;
    stateMessage?: string;
    startedAt: string | null;
    ports: { containerPort: number; protocol: string; name?: string }[];
    resources: {
      requestsCpu?: string;
      requestsMemory?: string;
      limitsCpu?: string;
      limitsMemory?: string;
    };
  }[];
  events: {
    type: string;
    reason: string;
    message: string;
    count: number;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  }[];
  rawYaml: string;
}

function isoTs(ts: Date | string | undefined): string | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts.toISOString();
  return ts as string;
}

function containerState(s?: V1ContainerStatus): {
  state: "running" | "waiting" | "terminated" | "unknown";
  reason?: string;
  message?: string;
  startedAt: string | null;
} {
  if (!s?.state) return { state: "unknown", startedAt: null };
  if (s.state.running) {
    return { state: "running", startedAt: isoTs(s.state.running.startedAt) };
  }
  if (s.state.waiting) {
    return {
      state: "waiting",
      reason: s.state.waiting.reason,
      message: s.state.waiting.message,
      startedAt: null,
    };
  }
  if (s.state.terminated) {
    return {
      state: "terminated",
      reason: s.state.terminated.reason,
      message: s.state.terminated.message,
      startedAt: isoTs(s.state.terminated.startedAt),
    };
  }
  return { state: "unknown", startedAt: null };
}

export async function getPod(
  config: KubernetesConfig,
  namespace: string,
  name: string
): Promise<PodDetail> {
  const { core } = buildClient(config);
  const [pod, eventsList] = await Promise.all([
    core.readNamespacedPod({ namespace, name }),
    core.listNamespacedEvent({
      namespace,
      fieldSelector: `involvedObject.name=${name},involvedObject.kind=Pod`,
    }),
  ]);

  const containerStatuses = pod.status?.containerStatuses ?? [];
  const statusByName = new Map<string, V1ContainerStatus>();
  for (const s of containerStatuses) statusByName.set(s.name, s);

  const containers = (pod.spec?.containers ?? []).map((c) => {
    const status = statusByName.get(c.name);
    const cs = containerState(status);
    return {
      name: c.name,
      image: c.image ?? "—",
      ready: status?.ready ?? false,
      restartCount: status?.restartCount ?? 0,
      state: cs.state,
      stateReason: cs.reason,
      stateMessage: cs.message,
      startedAt: cs.startedAt,
      ports: (c.ports ?? []).map((p) => ({
        containerPort: p.containerPort ?? 0,
        protocol: p.protocol ?? "TCP",
        name: p.name,
      })),
      resources: {
        requestsCpu: c.resources?.requests?.cpu,
        requestsMemory: c.resources?.requests?.memory,
        limitsCpu: c.resources?.limits?.cpu,
        limitsMemory: c.resources?.limits?.memory,
      },
    };
  });

  return {
    name: pod.metadata?.name ?? name,
    namespace: pod.metadata?.namespace ?? namespace,
    phase: pod.status?.phase ?? "Unknown",
    state: classifyPod(pod),
    podIp: pod.status?.podIP ?? null,
    hostIp: pod.status?.hostIP ?? null,
    nodeName: pod.spec?.nodeName ?? null,
    serviceAccount: pod.spec?.serviceAccountName ?? null,
    qosClass: pod.status?.qosClass ?? null,
    createdAt: isoTs(pod.metadata?.creationTimestamp),
    startTime: isoTs(pod.status?.startTime),
    labels: (pod.metadata?.labels ?? {}) as Record<string, string>,
    annotations: (pod.metadata?.annotations ?? {}) as Record<string, string>,
    conditions: (pod.status?.conditions ?? []).map((c: V1PodCondition) => ({
      type: c.type ?? "—",
      status: c.status ?? "—",
      reason: c.reason,
      message: c.message,
      lastTransitionTime: isoTs(c.lastTransitionTime),
    })),
    containers,
    events: eventsList.items
      .map((e) => ({
        type: e.type ?? "Normal",
        reason: e.reason ?? "—",
        message: e.message ?? "",
        count: e.count ?? 1,
        firstTimestamp: isoTs(e.firstTimestamp ?? e.eventTime ?? undefined),
        lastTimestamp: isoTs(e.lastTimestamp ?? e.eventTime ?? undefined),
      }))
      .sort((a, b) => {
        const ta = a.lastTimestamp ? Date.parse(a.lastTimestamp) : 0;
        const tb = b.lastTimestamp ? Date.parse(b.lastTimestamp) : 0;
        return tb - ta;
      }),
    rawYaml: JSON.stringify(pod, null, 2),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pod logs (single-shot, capped — streaming is a follow-up)
// ─────────────────────────────────────────────────────────────────────────────

export async function getPodLogs(
  config: KubernetesConfig,
  namespace: string,
  name: string,
  options: { container?: string; tailLines?: number; previous?: boolean }
): Promise<string> {
  const { core } = buildClient(config);
  const res = await core.readNamespacedPodLog({
    namespace,
    name,
    container: options.container,
    tailLines: options.tailLines ?? 500,
    previous: options.previous ?? false,
    timestamps: true,
  });
  return typeof res === "string" ? res : JSON.stringify(res);
}

// (SSE log streaming intentionally omitted from MVP — Logs tab uses
// one-shot fetching via getPodLogs above.)
