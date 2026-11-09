/**
 * Cluster overview aggregation. Pure and dependency-free (structural input
 * types, like mappers.ts) so "what needs attention" is testable without a
 * cluster. The driver (src/lib/connections/kubernetes/overview.ts) fetches,
 * this module interprets.
 */
import { secondsSince } from "./quantity";
import { parseCpu, parseMemoryBytes } from "./usage";

type Ts = string | Date | undefined;

export interface PodLike {
  metadata?: { name?: string; namespace?: string; creationTimestamp?: Ts; deletionTimestamp?: Ts };
  status?: {
    phase?: string;
    containerStatuses?: Array<{
      restartCount?: number;
      state?: {
        waiting?: { reason?: string; message?: string };
        terminated?: { reason?: string; exitCode?: number };
      };
    }>;
  };
}

export interface NodeLike {
  metadata?: { name?: string };
  status?: {
    conditions?: Array<{ type?: string; status?: string }>;
    allocatable?: Record<string, string>;
  };
}

export interface DeploymentLike {
  metadata?: { name?: string; namespace?: string };
  spec?: { replicas?: number };
  status?: { unavailableReplicas?: number; availableReplicas?: number };
}

export interface EventLike {
  metadata?: { namespace?: string; name?: string; creationTimestamp?: Ts };
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  involvedObject?: { kind?: string; name?: string };
  lastTimestamp?: Ts;
  eventTime?: Ts;
}

export interface NodeUsageLike {
  usage?: { cpu?: string; memory?: string };
}

/** Each section is optional: absent means it couldn't be loaded (see `notes`). */
export interface OverviewInput {
  pods?: PodLike[];
  nodes?: NodeLike[];
  deployments?: DeploymentLike[];
  events?: EventLike[];
  /** metrics-server node usage; undefined when metrics-server is unavailable. */
  nodeUsage?: NodeUsageLike[];
}

export interface AttentionItem {
  kind: "Pod" | "Node" | "Deployment";
  namespace?: string;
  name: string;
  reason: string;
  detail: string;
}

export interface WarningEvent {
  namespace: string;
  object: string;
  reason: string;
  message: string;
  count: number;
  ageSeconds: number;
}

export interface ClusterUsage {
  cpuMillicores: number;
  cpuAllocatable: number;
  memBytes: number;
  memAllocatable: number;
}

export interface ClusterOverview {
  pods: { total: number; Running: number; Pending: number; Failed: number; Succeeded: number; Unknown: number } | null;
  nodes: { total: number; ready: number } | null;
  deployments: { total: number; unavailable: number } | null;
  attention: AttentionItem[];
  warnings: WarningEvent[] | null;
  usage: ClusterUsage | null;
}

/** A pod Pending longer than this is stuck, not starting. */
export const PENDING_GRACE_SECONDS = 5 * 60;
export const RESTART_THRESHOLD = 5;
export const WARNING_LIMIT = 20;

const BAD_WAITING = new Set([
  "CrashLoopBackOff",
  "ImagePullBackOff",
  "ErrImagePull",
  "CreateContainerConfigError",
  "CreateContainerError",
  "InvalidImageName",
  "RunContainerError",
]);
const PRESSURE = ["MemoryPressure", "DiskPressure", "PIDPressure"];

export function podAttention(p: PodLike, now: Date): AttentionItem | null {
  const base = { kind: "Pod" as const, namespace: p.metadata?.namespace, name: p.metadata?.name ?? "—" };
  const statuses = p.status?.containerStatuses ?? [];
  for (const cs of statuses) {
    const w = cs.state?.waiting;
    if (w?.reason && BAD_WAITING.has(w.reason)) {
      return { ...base, reason: w.reason === "ErrImagePull" ? "ImagePullBackOff" : w.reason, detail: w.message ?? "" };
    }
  }
  if (p.status?.phase === "Failed" || statuses.some((cs) => cs.state?.terminated?.reason === "Error")) {
    return { ...base, reason: "Error", detail: `phase ${p.status?.phase ?? "Unknown"}` };
  }
  const restarts = statuses.reduce((s, cs) => s + (cs.restartCount ?? 0), 0);
  if (restarts >= RESTART_THRESHOLD) {
    return { ...base, reason: "Restarting", detail: `${restarts} restarts` };
  }
  const age = secondsSince(p.metadata?.creationTimestamp, now);
  if (p.status?.phase === "Pending" && !p.metadata?.deletionTimestamp && age > PENDING_GRACE_SECONDS) {
    return { ...base, reason: "Pending", detail: `pending ${Math.floor(age / 60)}m` };
  }
  return null;
}

function nodeAttention(n: NodeLike): AttentionItem[] {
  const name = n.metadata?.name ?? "—";
  const conds = n.status?.conditions ?? [];
  const out: AttentionItem[] = [];
  if (conds.find((c) => c.type === "Ready")?.status !== "True") {
    out.push({ kind: "Node", name, reason: "NotReady", detail: "Ready condition is not True" });
  }
  for (const type of PRESSURE) {
    if (conds.find((c) => c.type === type)?.status === "True") {
      out.push({ kind: "Node", name, reason: type, detail: `${type} reported by kubelet` });
    }
  }
  return out;
}

export function buildOverview(input: OverviewInput, now: Date = new Date()): ClusterOverview {
  const attention: AttentionItem[] = [];

  let pods: ClusterOverview["pods"] = null;
  if (input.pods) {
    pods = { total: input.pods.length, Running: 0, Pending: 0, Failed: 0, Succeeded: 0, Unknown: 0 };
    for (const p of input.pods) {
      const phase = p.status?.phase;
      if (phase === "Running" || phase === "Pending" || phase === "Failed" || phase === "Succeeded") pods[phase] += 1;
      else pods.Unknown += 1;
      const a = podAttention(p, now);
      if (a) attention.push(a);
    }
  }

  let nodes: ClusterOverview["nodes"] = null;
  if (input.nodes) {
    nodes = { total: input.nodes.length, ready: 0 };
    for (const n of input.nodes) {
      if (n.status?.conditions?.find((c) => c.type === "Ready")?.status === "True") nodes.ready += 1;
      attention.push(...nodeAttention(n));
    }
  }

  let deployments: ClusterOverview["deployments"] = null;
  if (input.deployments) {
    deployments = { total: input.deployments.length, unavailable: 0 };
    for (const d of input.deployments) {
      const unavailable = d.status?.unavailableReplicas ?? 0;
      if (unavailable > 0) {
        deployments.unavailable += 1;
        attention.push({
          kind: "Deployment",
          namespace: d.metadata?.namespace,
          name: d.metadata?.name ?? "—",
          reason: "Unavailable",
          detail: `${d.status?.availableReplicas ?? 0}/${d.spec?.replicas ?? 0} available`,
        });
      }
    }
  }

  const warnings = input.events
    ? input.events
        .filter((e) => e.type === "Warning")
        .map((e) => ({
          namespace: e.metadata?.namespace ?? "default",
          object: e.involvedObject?.kind && e.involvedObject?.name ? `${e.involvedObject.kind}/${e.involvedObject.name}` : "—",
          reason: e.reason || "—",
          message: e.message || "—",
          count: e.count ?? 1,
          ageSeconds: secondsSince(e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp, now),
        }))
        .sort((a, z) => a.ageSeconds - z.ageSeconds)
        .slice(0, WARNING_LIMIT)
    : null;

  let usage: ClusterUsage | null = null;
  if (input.nodeUsage && input.nodes) {
    usage = { cpuMillicores: 0, cpuAllocatable: 0, memBytes: 0, memAllocatable: 0 };
    for (const m of input.nodeUsage) {
      usage.cpuMillicores += parseCpu(m.usage?.cpu) ?? 0;
      usage.memBytes += parseMemoryBytes(m.usage?.memory) ?? 0;
    }
    for (const n of input.nodes) {
      usage.cpuAllocatable += parseCpu(n.status?.allocatable?.cpu) ?? 0;
      usage.memAllocatable += parseMemoryBytes(n.status?.allocatable?.memory) ?? 0;
    }
  }

  return { pods, nodes, deployments, attention, warnings, usage };
}
