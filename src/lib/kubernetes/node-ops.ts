/**
 * Pure parts of the node actions (cordon, uncordon, drain). What makes drain
 * correct is deciding *which* pods to evict, so that decision lives here where
 * it can be tested without a cluster.
 */

interface NodeLike {
  metadata?: { name?: string };
  spec?: { unschedulable?: boolean; [key: string]: unknown };
}

interface PodLike {
  metadata?: {
    name?: string;
    namespace?: string;
    deletionTimestamp?: string | Date;
    annotations?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string }>;
  };
  spec?: { nodeName?: string };
}

export interface EvictTarget {
  namespace: string;
  name: string;
}

/** Copy of `node` with the cordon flag set or cleared. */
export function withUnschedulable(node: NodeLike, unschedulable: boolean): NodeLike {
  return { ...node, spec: { ...(node.spec ?? {}), unschedulable } };
}

/**
 * The pods `kubectl drain` would evict from a node.
 *
 * Skipped, matching kubectl's defaults:
 *  - mirror pods — static pods the kubelet owns; eviction can't remove them
 *  - DaemonSet pods — the controller reschedules them onto the same node
 *  - pods already terminating — nothing left to evict
 */
export function evictablePods(pods: PodLike[], nodeName: string): EvictTarget[] {
  return pods
    .filter((p) => p.spec?.nodeName === nodeName)
    .filter((p) => !p.metadata?.deletionTimestamp)
    .filter((p) => !p.metadata?.annotations?.["kubernetes.io/config.mirror"])
    .filter((p) => !(p.metadata?.ownerReferences ?? []).some((o) => o.kind === "DaemonSet"))
    .map((p) => ({
      namespace: p.metadata?.namespace ?? "default",
      name: p.metadata?.name ?? "",
    }))
    .filter((t) => t.name !== "");
}
