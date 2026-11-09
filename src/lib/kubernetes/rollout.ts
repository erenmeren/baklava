/**
 * Pure parts of `kubectl rollout status / history / undo`. The driver fetches
 * the Deployment and its ReplicaSets; deciding which ReplicaSets belong to it,
 * how they order, and what an undo writes back lives here, testable without a
 * cluster.
 */

/** Stamped on every ReplicaSet (and its Deployment) by the controller. */
export const REVISION_ANNOTATION = "deployment.kubernetes.io/revision";
/** What `kubectl rollout history` shows in its CHANGE-CAUSE column. */
export const CHANGE_CAUSE_ANNOTATION = "kubernetes.io/change-cause";
/** Added to the pod template by the controller — must not be written back. */
export const POD_TEMPLATE_HASH_LABEL = "pod-template-hash";

interface Meta {
  name?: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string | Date;
  ownerReferences?: Array<{ uid?: string; kind?: string; controller?: boolean }>;
}

interface PodTemplateLike {
  metadata?: Meta;
  spec?: { containers?: Array<{ name?: string; image?: string }>; [key: string]: unknown };
  [key: string]: unknown;
}

export interface ReplicaSetLike {
  metadata?: Meta;
  spec?: { replicas?: number; template?: PodTemplateLike };
  status?: { replicas?: number; readyReplicas?: number };
}

interface Condition {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
}

export interface DeploymentStatusLike {
  metadata?: Meta & { generation?: number };
  spec?: { replicas?: number; paused?: boolean };
  status?: {
    observedGeneration?: number;
    replicas?: number;
    updatedReplicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    conditions?: Condition[];
  };
}

export interface RolloutStatus {
  desired: number;
  updated: number;
  ready: number;
  available: number;
  paused: boolean;
  /** The `Progressing` condition, when the controller has reported one. */
  progressing: { status: string; reason: string; message: string } | null;
  /** Every replica is on the new template and available — kubectl's "successfully rolled out". */
  complete: boolean;
}

export interface Revision {
  revision: number;
  replicaSet: string;
  changeCause: string;
  images: string[];
  replicas: number;
  /** This is the template the Deployment is running now. */
  current: boolean;
}

export function rolloutStatus(d: DeploymentStatusLike): RolloutStatus {
  const s = d.status ?? {};
  const desired = d.spec?.replicas ?? 1;
  const updated = s.updatedReplicas ?? 0;
  const available = s.availableReplicas ?? 0;
  const cond = s.conditions?.find((c) => c.type === "Progressing");
  const observed =
    d.metadata?.generation === undefined ||
    (s.observedGeneration ?? 0) >= d.metadata.generation;
  return {
    desired,
    updated,
    ready: s.readyReplicas ?? 0,
    available,
    paused: d.spec?.paused === true,
    progressing: cond
      ? { status: cond.status ?? "", reason: cond.reason ?? "", message: cond.message ?? "" }
      : null,
    // Same test kubectl's rollout status uses: no old replicas left over.
    complete:
      observed && updated === desired && (s.replicas ?? 0) === updated && available === updated,
  };
}

export function revisionOf(obj: { metadata?: Meta }): number {
  const n = Number(obj.metadata?.annotations?.[REVISION_ANNOTATION]);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** ReplicaSets controlled by the Deployment, newest revision first. */
export function rolloutHistory(
  deployment: { metadata?: Meta },
  replicaSets: ReplicaSetLike[],
): Revision[] {
  const uid = deployment.metadata?.uid;
  const current = revisionOf(deployment);
  return replicaSets
    .filter((rs) =>
      rs.metadata?.ownerReferences?.some((o) => o.uid === uid && o.controller !== false),
    )
    .map((rs) => {
      const revision = revisionOf(rs);
      return {
        revision,
        replicaSet: rs.metadata?.name ?? "",
        changeCause: rs.metadata?.annotations?.[CHANGE_CAUSE_ANNOTATION] ?? "",
        images: (rs.spec?.template?.spec?.containers ?? []).map((c) => c.image ?? ""),
        replicas: rs.status?.replicas ?? 0,
        current: revision === current,
      };
    })
    .filter((r) => r.revision > 0)
    .sort((a, b) => b.revision - a.revision);
}

/** Validate a revision number coming off an HTTP body. */
export function parseRevision(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
    throw new Error("revision must be a positive integer");
  }
  return n;
}

/**
 * The JSON patch `kubectl rollout undo --to-revision` sends: replace the whole
 * pod template with the target ReplicaSet's, minus the `pod-template-hash`
 * label the controller added. A replace (not a strategic merge) so anything
 * the later revision *added* — an env var, a sidecar — is actually removed.
 */
export function undoPatch(
  replicaSets: ReplicaSetLike[],
  deployment: { metadata?: Meta },
  revision: number,
): Array<{ op: "replace"; path: string; value: unknown }> {
  const target = rolloutHistory(deployment, replicaSets).find((r) => r.revision === revision);
  if (!target) throw new Error(`revision ${revision} not found`);
  if (target.current) throw new Error(`revision ${revision} is already running`);
  const rs = replicaSets.find((r) => r.metadata?.name === target.replicaSet)!;
  const template = structuredClone(rs.spec?.template ?? {});
  const labels = { ...(template.metadata?.labels ?? {}) };
  delete labels[POD_TEMPLATE_HASH_LABEL];
  template.metadata = { ...(template.metadata ?? {}), labels };
  return [{ op: "replace", path: "/spec/template", value: template }];
}
