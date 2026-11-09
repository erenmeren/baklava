/**
 * Cluster topology: nodes, their role, and the workloads running on each.
 * Pure (structural input types, like overview.ts) — the driver
 * (src/lib/connections/kubernetes/topology.ts) fetches, this module groups.
 */
import { podAttention, type PodLike, type NodeLike } from "./overview";
import { parseCpu, parseMemoryBytes, percentOf } from "./usage";

interface OwnerRef {
  kind?: string;
  name?: string;
  controller?: boolean;
}

export interface TopoPodLike extends PodLike {
  metadata?: PodLike["metadata"] & { ownerReferences?: OwnerRef[] };
  spec?: { nodeName?: string };
}

export interface TopoNodeLike extends NodeLike {
  metadata?: { name?: string; labels?: Record<string, string> };
}

export interface ReplicaSetLike {
  metadata?: { name?: string; namespace?: string; ownerReferences?: OwnerRef[] };
}

export interface PodMetricsLike {
  metadata?: { name?: string; namespace?: string };
  containers?: Array<{ usage?: { cpu?: string; memory?: string } }>;
}

export interface NodeMetricsLike {
  metadata?: { name?: string };
  usage?: { cpu?: string; memory?: string };
}

/** Each section is optional: absent means it couldn't be loaded. */
export interface TopologyInput {
  nodes?: TopoNodeLike[];
  pods?: TopoPodLike[];
  replicaSets?: ReplicaSetLike[];
  /** metrics-server usage; undefined when it is unavailable. */
  podUsage?: PodMetricsLike[];
  nodeUsage?: NodeMetricsLike[];
}

/** "unknown": the node is only known from a pod's spec.nodeName (nodes not listable). */
export type NodeRole = "control-plane" | "worker" | "unknown";

export interface TopologyPod {
  namespace: string;
  name: string;
  phase: string;
  /** Overview's "needs attention" reason (CrashLoopBackOff, Pending…), or null. */
  problem: string | null;
  cpuMillicores: number | null;
  memBytes: number | null;
}

export interface TopologyWorkload {
  /** Deployment / StatefulSet / DaemonSet / Job / ReplicaSet / … or "Pod" for a bare pod. */
  kind: string;
  namespace: string;
  name: string;
  /** Pods of this workload in this group (on this node). */
  replicas: number;
  cpuPerPod: number | null;
  memPerPod: number | null;
  problem: boolean;
  pods: TopologyPod[];
}

export interface Usage {
  used: number;
  allocatable: number;
  pct: number | null;
}

export interface TopologyNode {
  name: string;
  role: NodeRole;
  /** null when the node object itself isn't visible. */
  ready: boolean | null;
  cpu: Usage | null;
  mem: Usage | null;
  podCount: number;
  workloads: TopologyWorkload[];
}

export interface Topology {
  nodes: TopologyNode[];
  /** Pods with no node yet (Pending, not scheduled). */
  unscheduled: TopologyWorkload[];
  summary: {
    nodes: number;
    controlPlane: number;
    workers: number;
    pods: number;
    cpuPct: number | null;
    memPct: number | null;
  };
}

const CP_LABELS = ["node-role.kubernetes.io/control-plane", "node-role.kubernetes.io/master"];

export function nodeRole(n: TopoNodeLike): NodeRole {
  const labels = n.metadata?.labels ?? {};
  return CP_LABELS.some((l) => l in labels) ? "control-plane" : "worker";
}

function controllerOf(refs: OwnerRef[] | undefined): OwnerRef | undefined {
  return refs?.find((r) => r.controller) ?? refs?.[0];
}

/** Pod → owning workload; a ReplicaSet resolves on to its Deployment when the RS is known. */
export function resolveOwner(
  pod: TopoPodLike,
  replicaSets: Map<string, ReplicaSetLike>,
): { kind: string; name: string } {
  const ns = pod.metadata?.namespace ?? "default";
  const ref = controllerOf(pod.metadata?.ownerReferences);
  if (!ref?.kind || !ref.name) return { kind: "Pod", name: pod.metadata?.name ?? "—" };
  if (ref.kind === "ReplicaSet") {
    const up = controllerOf(replicaSets.get(`${ns}/${ref.name}`)?.metadata?.ownerReferences);
    if (up?.kind && up.name) return { kind: up.kind, name: up.name };
  }
  return { kind: ref.kind, name: ref.name };
}

const avg = (xs: Array<number | null>): number | null => {
  const known = xs.filter((x): x is number => x !== null);
  return known.length ? known.reduce((s, x) => s + x, 0) / known.length : null;
};

function groupWorkloads(pods: Array<{ pod: TopologyPod; kind: string; owner: string }>): TopologyWorkload[] {
  const by = new Map<string, TopologyWorkload>();
  for (const { pod, kind, owner } of pods) {
    const key = `${kind}/${pod.namespace}/${owner}`;
    let w = by.get(key);
    if (!w) {
      w = { kind, namespace: pod.namespace, name: owner, replicas: 0, cpuPerPod: null, memPerPod: null, problem: false, pods: [] };
      by.set(key, w);
    }
    w.pods.push(pod);
    w.replicas += 1;
    if (pod.problem) w.problem = true;
  }
  const out = [...by.values()];
  for (const w of out) {
    w.cpuPerPod = avg(w.pods.map((p) => p.cpuMillicores));
    w.memPerPod = avg(w.pods.map((p) => p.memBytes));
  }
  // Problems first, then by namespace/name — a broken workload shouldn't hide at the bottom.
  return out.sort(
    (a, z) => Number(z.problem) - Number(a.problem) || `${a.namespace}/${a.name}`.localeCompare(`${z.namespace}/${z.name}`),
  );
}

function usageOf(used: number | null, allocatable: number | null): Usage | null {
  if (used === null || allocatable === null) return null;
  return { used, allocatable, pct: percentOf(used, allocatable) };
}

export function buildTopology(input: TopologyInput, now: Date = new Date()): Topology {
  const rsMap = new Map((input.replicaSets ?? []).map((rs) => [`${rs.metadata?.namespace ?? "default"}/${rs.metadata?.name ?? ""}`, rs]));
  const podMetrics = new Map<string, { cpu: number; mem: number }>();
  for (const m of input.podUsage ?? []) {
    let cpu = 0;
    let mem = 0;
    for (const c of m.containers ?? []) {
      cpu += parseCpu(c.usage?.cpu) ?? 0;
      mem += parseMemoryBytes(c.usage?.memory) ?? 0;
    }
    podMetrics.set(`${m.metadata?.namespace ?? "default"}/${m.metadata?.name ?? ""}`, { cpu, mem });
  }
  const nodeMetrics = new Map((input.nodeUsage ?? []).map((m) => [m.metadata?.name ?? "", m.usage]));

  // Pods per node name ("" = unscheduled). Succeeded pods are finished work, not
  // load on a node — left out, like kubectl's "Non-terminated Pods".
  const byNode = new Map<string, Array<{ pod: TopologyPod; kind: string; owner: string }>>();
  for (const p of input.pods ?? []) {
    if (p.status?.phase === "Succeeded") continue;
    const namespace = p.metadata?.namespace ?? "default";
    const name = p.metadata?.name ?? "—";
    const m = podMetrics.get(`${namespace}/${name}`);
    const pod: TopologyPod = {
      namespace,
      name,
      phase: p.status?.phase ?? "Unknown",
      problem: podAttention(p, now)?.reason ?? null,
      cpuMillicores: m ? m.cpu : null,
      memBytes: m ? m.mem : null,
    };
    const owner = resolveOwner(p, rsMap);
    const node = p.spec?.nodeName ?? "";
    const list = byNode.get(node) ?? [];
    list.push({ pod, kind: owner.kind, owner: owner.name });
    byNode.set(node, list);
  }

  const nodes: TopologyNode[] = [];
  const seen = new Set<string>();
  for (const n of input.nodes ?? []) {
    const name = n.metadata?.name ?? "—";
    seen.add(name);
    const u = nodeMetrics.get(name);
    const pods = byNode.get(name) ?? [];
    nodes.push({
      name,
      role: nodeRole(n),
      ready: n.status?.conditions?.find((c) => c.type === "Ready")?.status === "True",
      cpu: u ? usageOf(parseCpu(u.cpu), parseCpu(n.status?.allocatable?.cpu)) : null,
      mem: u ? usageOf(parseMemoryBytes(u.memory), parseMemoryBytes(n.status?.allocatable?.memory)) : null,
      podCount: pods.length,
      workloads: groupWorkloads(pods),
    });
  }
  // Nodes only known from pods (the node list failed or was truncated).
  for (const [name, pods] of byNode) {
    if (!name || seen.has(name)) continue;
    nodes.push({ name, role: "unknown", ready: null, cpu: null, mem: null, podCount: pods.length, workloads: groupWorkloads(pods) });
  }
  nodes.sort((a, z) => a.name.localeCompare(z.name));

  const total = (k: "cpu" | "mem") => {
    const known = nodes.map((n) => n[k]).filter((u): u is Usage => u !== null);
    if (!known.length) return null;
    return percentOf(
      known.reduce((s, u) => s + u.used, 0),
      known.reduce((s, u) => s + u.allocatable, 0),
    );
  };

  const unscheduledPods = byNode.get("") ?? [];
  return {
    nodes,
    unscheduled: groupWorkloads(unscheduledPods),
    summary: {
      nodes: nodes.length,
      controlPlane: nodes.filter((n) => n.role === "control-plane").length,
      workers: nodes.filter((n) => n.role === "worker").length,
      pods: [...byNode.values()].reduce((s, l) => s + l.length, 0),
      cpuPct: total("cpu"),
      memPct: total("mem"),
    },
  };
}
