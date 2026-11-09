import "server-only";
import type { KubernetesConfig } from "../types";
import { bundleFor } from "@/lib/connections/kubernetes";
import { formatError } from "@/lib/errors";
import { LIST_LIMIT } from "@/lib/kubernetes/list";
import { ALL_NAMESPACES } from "@/lib/kubernetes/namespace";
import { buildOverview, type ClusterOverview, type OverviewInput } from "@/lib/kubernetes/overview";

export interface OverviewSectionNote {
  section: "pods" | "nodes" | "deployments" | "events" | "metrics";
  error: string;
}

export interface ClusterOverviewResult extends ClusterOverview {
  /** Sections that couldn't load (e.g. 403 on a cluster-wide list) — shown, not fatal. */
  notes: OverviewSectionNote[];
  /** metrics-server answered 404: usage isn't an error, it's just not installed. */
  metricsMissing: boolean;
  /** Pods/deployments/events were listed in this namespace ("*" = all). */
  namespace: string;
}

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 404 || /\b404\b|not found/i.test(formatError(err));
}

/**
 * Everything the overview page shows, in one round of parallel list calls.
 * Each list fails on its own: a namespace-restricted kubeconfig 403s on nodes
 * (cluster-scoped) but can still show its namespace's pods.
 */
export async function getClusterOverview(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
): Promise<ClusterOverviewResult> {
  const b = await bundleFor(connectionId, cfg);
  const scoped = namespace && namespace !== ALL_NAMESPACES ? namespace : null;
  const [pods, nodes, deployments, events, metrics] = await Promise.allSettled([
    scoped
      ? b.core.listNamespacedPod({ namespace: scoped, limit: LIST_LIMIT })
      : b.core.listPodForAllNamespaces({ limit: LIST_LIMIT }),
    b.core.listNode({ limit: LIST_LIMIT }),
    scoped
      ? b.apps.listNamespacedDeployment({ namespace: scoped, limit: LIST_LIMIT })
      : b.apps.listDeploymentForAllNamespaces({ limit: LIST_LIMIT }),
    scoped
      ? b.core.listNamespacedEvent({ namespace: scoped, limit: LIST_LIMIT })
      : b.core.listEventForAllNamespaces({ limit: LIST_LIMIT }),
    b.metrics.getNodeMetrics(),
  ]);

  const notes: OverviewSectionNote[] = [];
  const take = <T,>(section: OverviewSectionNote["section"], r: PromiseSettledResult<{ items: T[] }>) => {
    if (r.status === "fulfilled") return r.value.items;
    notes.push({ section, error: formatError(r.reason) });
    return undefined;
  };
  let metricsMissing = false;
  let nodeUsage: OverviewInput["nodeUsage"];
  if (metrics.status === "fulfilled") nodeUsage = metrics.value.items;
  else if (isNotFound(metrics.reason)) metricsMissing = true;
  else notes.push({ section: "metrics", error: formatError(metrics.reason) });

  const overview = buildOverview({
    pods: take("pods", pods),
    nodes: take("nodes", nodes),
    deployments: take("deployments", deployments),
    events: take("events", events),
    nodeUsage,
  });
  return { ...overview, notes, metricsMissing, namespace: scoped ?? ALL_NAMESPACES };
}
