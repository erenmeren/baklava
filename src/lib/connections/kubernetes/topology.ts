import "server-only";
import type { KubernetesConfig } from "../types";
import { bundleFor } from "@/lib/connections/kubernetes";
import { formatError } from "@/lib/errors";
import { LIST_LIMIT } from "@/lib/kubernetes/list";
import { ALL_NAMESPACES } from "@/lib/kubernetes/namespace";
import { buildTopology, type Topology } from "@/lib/kubernetes/topology";

export interface TopologySectionNote {
  section: "nodes" | "pods" | "replicasets" | "metrics";
  error: string;
}

export interface ClusterTopologyResult extends Topology {
  /** Sections that couldn't load or were cut at LIST_LIMIT — shown, not fatal. */
  notes: TopologySectionNote[];
  /** metrics-server answered 404: no usage, and that isn't an error. */
  metricsMissing: boolean;
  /** Pods were listed in this namespace ("*" = all); nodes are always cluster-wide. */
  namespace: string;
}

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 404 || /\b404\b|not found/i.test(formatError(err));
}

type Listed<T> = { items: T[]; metadata?: { _continue?: string } };

/**
 * Nodes + pods (+ ReplicaSets, to resolve pods to their Deployment) + usage,
 * in one round of parallel calls. Each fails on its own: a namespace-restricted
 * kubeconfig 403s on nodes but can still place its pods.
 */
export async function getClusterTopology(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
): Promise<ClusterTopologyResult> {
  const b = await bundleFor(connectionId, cfg);
  const scoped = namespace && namespace !== ALL_NAMESPACES ? namespace : null;
  const [nodes, pods, replicaSets, nodeMetrics, podMetrics] = await Promise.allSettled([
    b.core.listNode({ limit: LIST_LIMIT }),
    scoped
      ? b.core.listNamespacedPod({ namespace: scoped, limit: LIST_LIMIT })
      : b.core.listPodForAllNamespaces({ limit: LIST_LIMIT }),
    scoped
      ? b.apps.listNamespacedReplicaSet({ namespace: scoped, limit: LIST_LIMIT })
      : b.apps.listReplicaSetForAllNamespaces({ limit: LIST_LIMIT }),
    b.metrics.getNodeMetrics(),
    b.metrics.getPodMetrics(scoped ?? undefined),
  ]);

  const notes: TopologySectionNote[] = [];
  const take = <T,>(section: TopologySectionNote["section"], r: PromiseSettledResult<Listed<T>>) => {
    if (r.status === "rejected") {
      notes.push({ section, error: formatError(r.reason) });
      return undefined;
    }
    if (r.value.metadata?._continue) {
      notes.push({ section, error: `showing the first ${LIST_LIMIT} — the topology is incomplete` });
    }
    return r.value.items;
  };

  let metricsMissing = false;
  const usage = <T,>(r: PromiseSettledResult<{ items: T[] }>) => {
    if (r.status === "fulfilled") return r.value.items;
    if (isNotFound(r.reason)) metricsMissing = true;
    else if (!notes.some((n) => n.section === "metrics")) notes.push({ section: "metrics", error: formatError(r.reason) });
    return undefined;
  };

  const topology = buildTopology({
    nodes: take("nodes", nodes),
    pods: take("pods", pods),
    replicaSets: take("replicasets", replicaSets),
    nodeUsage: usage(nodeMetrics),
    podUsage: usage(podMetrics),
  });
  return { ...topology, notes, metricsMissing, namespace: scoped ?? ALL_NAMESPACES };
}
