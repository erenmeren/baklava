/**
 * Cluster object → table row. Pure and dependency-free (structural input
 * types, no `@kubernetes/client-node` import) so the interesting part — how a
 * Node's conditions become one status string, what "last seen" means for an
 * Event — is testable without a cluster.
 */
import { humanQuantity, secondsSince } from "./quantity";
import type { EventRow, NodeRow } from "./row-types";

interface NodeLike {
  metadata?: {
    name?: string;
    creationTimestamp?: string | Date;
    labels?: Record<string, string>;
  };
  spec?: { unschedulable?: boolean };
  status?: {
    conditions?: Array<{ type?: string; status?: string }>;
    nodeInfo?: {
      kubeletVersion?: string;
      operatingSystem?: string;
      architecture?: string;
    };
    addresses?: Array<{ type?: string; address?: string }>;
    capacity?: Record<string, string>;
  };
}

interface EventLike {
  metadata?: { namespace?: string; name?: string; creationTimestamp?: string | Date };
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  involvedObject?: { kind?: string; name?: string };
  lastTimestamp?: string | Date;
  eventTime?: string | Date;
}

const DASH = "—";

export function mapNode(node: NodeLike, now: Date = new Date()): NodeRow {
  const ready = node.status?.conditions?.find((c) => c.type === "Ready");
  const base =
    ready?.status === "True" ? "Ready" : ready?.status === "False" ? "NotReady" : "Unknown";
  // `kubectl get nodes` appends the cordon state to the Ready status rather
  // than replacing it — a cordoned node is still Ready, just closed for new pods.
  const schedulable = node.spec?.unschedulable !== true;
  const status = schedulable ? base : `${base},SchedulingDisabled`;

  const roles = Object.keys(node.metadata?.labels ?? {})
    .filter((k) => k.startsWith("node-role.kubernetes.io/"))
    .map((k) => k.slice("node-role.kubernetes.io/".length))
    .filter(Boolean)
    .sort();

  const internalIP =
    node.status?.addresses?.find((a) => a.type === "InternalIP")?.address ?? DASH;
  const capacity = node.status?.capacity ?? {};

  return {
    name: node.metadata?.name ?? DASH,
    status,
    schedulable,
    roles: roles.length ? roles.join(",") : "<none>",
    version: node.status?.nodeInfo?.kubeletVersion ?? DASH,
    os: [node.status?.nodeInfo?.operatingSystem, node.status?.nodeInfo?.architecture]
      .filter(Boolean)
      .join("/") || DASH,
    internalIP,
    cpu: capacity.cpu ?? DASH,
    memory: humanQuantity(capacity.memory),
    podCapacity: Number(capacity.pods ?? 0) || 0,
    ageSeconds: secondsSince(node.metadata?.creationTimestamp, now),
  };
}

export function mapEvent(event: EventLike, now: Date = new Date()): EventRow {
  const involved = event.involvedObject;
  const object =
    involved?.kind && involved?.name ? `${involved.kind}/${involved.name}` : DASH;
  // "Last seen" is the point of an event list, so age comes from lastTimestamp
  // (or the newer eventTime) and only falls back to creation.
  const seenAt = event.lastTimestamp ?? event.eventTime ?? event.metadata?.creationTimestamp;

  return {
    namespace: event.metadata?.namespace ?? "default",
    name: event.metadata?.name ?? DASH,
    type: event.type === "Warning" ? "Warning" : "Normal",
    reason: event.reason || DASH,
    object,
    message: event.message || DASH,
    count: event.count ?? 1,
    ageSeconds: secondsSince(seenAt, now),
  };
}
