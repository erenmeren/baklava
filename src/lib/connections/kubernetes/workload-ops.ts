import "server-only";
import { randomBytes } from "node:crypto";
import type { KubernetesObject } from "@kubernetes/client-node"; // type-only
import type { KubernetesConfig } from "../types";
import { bundleFor, getK8s, streamPodLogs, type LogStream } from "@/lib/connections/kubernetes";
import { withReplicas, withRestartedAt } from "@/lib/kubernetes/deployment-ops";
import {
  rolloutHistory,
  rolloutStatus,
  undoPatch,
  type ReplicaSetLike,
  type Revision,
  type RolloutStatus,
} from "@/lib/kubernetes/rollout";
import {
  MAX_LOG_PODS,
  WORKLOAD_KINDS,
  jobFromCronJob,
  podColor,
  selectorToString,
  type WorkloadKind,
} from "@/lib/kubernetes/workload-ops";

/**
 * Deployment rollouts, StatefulSet / DaemonSet restart + scale, CronJob runs
 * and aggregated workload logs. Every mutation is a PATCH or a create — never
 * read-modify-replace (see the Kubernetes notes in AGENTS.md).
 */

async function strategicPatch(
  connectionId: string,
  cfg: KubernetesConfig,
  obj: KubernetesObject,
  strategy: "StrategicMergePatch" | "MergePatch" = "StrategicMergePatch",
): Promise<void> {
  const { PatchStrategy } = await getK8s();
  const b = await bundleFor(connectionId, cfg);
  await b.objects.patch(obj, undefined, undefined, undefined, undefined, PatchStrategy[strategy]);
}

// ── Rollouts ────────────────────────────────────────────────────────────────

export interface RolloutInfo {
  status: RolloutStatus;
  history: Revision[];
}

async function deploymentAndReplicaSets(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
) {
  const b = await bundleFor(connectionId, cfg);
  const deployment = await b.apps.readNamespacedDeployment({ namespace, name });
  // Owned ReplicaSets carry the deployment's selector labels; ownership is
  // then checked by uid in rolloutHistory.
  const rs = await b.apps.listNamespacedReplicaSet({
    namespace,
    labelSelector: selectorToString(deployment.spec?.selector),
  });
  return { b, deployment, replicaSets: rs.items as ReplicaSetLike[] };
}

export async function getRollout(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
): Promise<RolloutInfo> {
  const { deployment, replicaSets } = await deploymentAndReplicaSets(connectionId, cfg, namespace, name);
  return {
    status: rolloutStatus(deployment),
    history: rolloutHistory(deployment, replicaSets),
  };
}

/**
 * `kubectl rollout undo --to-revision`: a JSON patch replacing the pod
 * template with the target ReplicaSet's. The template goes back through
 * JSON.stringify as-is — the client's pod-template models use the wire field
 * names, so no re-serialisation is needed.
 */
export async function undoRollout(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
  revision: number,
): Promise<void> {
  const { PatchStrategy, setHeaderOptions } = await getK8s();
  const { b, deployment, replicaSets } = await deploymentAndReplicaSets(
    connectionId,
    cfg,
    namespace,
    name,
  );
  if (deployment.spec?.paused) {
    throw new Error("deployment is paused — resume it before rolling back");
  }
  await b.apps.patchNamespacedDeployment(
    { namespace, name, body: undoPatch(replicaSets, deployment, revision) },
    setHeaderOptions("Content-Type", PatchStrategy.JsonPatch),
  );
}

// ── StatefulSet / DaemonSet ─────────────────────────────────────────────────

/** `kubectl rollout restart` for any workload with a pod template. */
export async function restartWorkload(
  connectionId: string,
  cfg: KubernetesConfig,
  kind: WorkloadKind,
  namespace: string,
  name: string,
): Promise<void> {
  await strategicPatch(connectionId, cfg, {
    apiVersion: "apps/v1",
    kind: WORKLOAD_KINDS[kind],
    metadata: { name, namespace },
    ...withRestartedAt({}, new Date().toISOString()),
  } as KubernetesObject);
}

export async function scaleStatefulSet(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
  replicas: number,
): Promise<void> {
  await strategicPatch(connectionId, cfg, {
    apiVersion: "apps/v1",
    kind: "StatefulSet",
    metadata: { name, namespace },
    ...withReplicas({}, replicas),
  } as KubernetesObject);
}

// ── CronJob ─────────────────────────────────────────────────────────────────

/** `kubectl create job --from=cronjob/<name>`. Returns the new Job's name. */
export async function triggerCronJob(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
): Promise<string> {
  const b = await bundleFor(connectionId, cfg);
  const cj = await b.batch.readNamespacedCronJob({ namespace, name });
  const job = jobFromCronJob(cj, randomBytes(3).toString("hex"));
  const created = await b.batch.createNamespacedJob({ namespace, body: job as never });
  return created.metadata?.name ?? job.metadata.name;
}

export async function setCronJobSuspended(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  name: string,
  suspend: boolean,
): Promise<void> {
  await strategicPatch(
    connectionId,
    cfg,
    { apiVersion: "batch/v1", kind: "CronJob", metadata: { name, namespace }, spec: { suspend } } as KubernetesObject,
    "MergePatch",
  );
}

// ── Aggregated logs ─────────────────────────────────────────────────────────

export interface WorkloadLogSource {
  pod: string;
  container: string;
  color: number;
  stream: LogStream;
}

export interface WorkloadLogs {
  sources: WorkloadLogSource[];
  /** More pods matched than MAX_LOG_PODS — the rest are not followed. */
  truncated: boolean;
}

/**
 * Follow the logs of every pod a workload selects (stern-style), capped at
 * MAX_LOG_PODS. Each pod follows `container` when it has one by that name,
 * else its first container. On a partial failure every stream already opened
 * is aborted before the error propagates.
 */
export async function streamWorkloadLogs(
  connectionId: string,
  cfg: KubernetesConfig,
  kind: WorkloadKind,
  namespace: string,
  name: string,
  options: { container?: string; tailLines?: number } = {},
): Promise<WorkloadLogs> {
  const b = await bundleFor(connectionId, cfg);
  const read = {
    deployment: () => b.apps.readNamespacedDeployment({ namespace, name }),
    statefulset: () => b.apps.readNamespacedStatefulSet({ namespace, name }),
    daemonset: () => b.apps.readNamespacedDaemonSet({ namespace, name }),
  }[kind];
  const workload = await read();
  const pods = await b.core.listNamespacedPod({
    namespace,
    labelSelector: selectorToString(workload.spec?.selector),
    limit: 100,
  });
  const live = pods.items.filter((p) => !p.metadata?.deletionTimestamp);
  const picked = live.slice(0, MAX_LOG_PODS);
  const sources: WorkloadLogSource[] = [];
  try {
    for (const p of picked) {
      const pod = p.metadata?.name ?? "";
      const names = (p.spec?.containers ?? []).map((c) => c.name);
      const container =
        options.container && names.includes(options.container) ? options.container : names[0] ?? "";
      const stream = await streamPodLogs(connectionId, cfg, namespace, pod, {
        follow: true,
        tailLines: options.tailLines ?? 50,
        container,
      });
      sources.push({ pod, container, color: podColor(pod), stream });
    }
  } catch (err) {
    for (const s of sources) s.stream.abort();
    throw err;
  }
  return {
    sources,
    truncated: live.length > picked.length || Boolean(pods.metadata?._continue),
  };
}
