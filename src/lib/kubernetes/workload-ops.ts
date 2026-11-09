/**
 * Pure parts of the StatefulSet / DaemonSet / CronJob actions and the
 * aggregated (stern-like) log view: which objects an action may target, what a
 * manual CronJob run creates, and how a workload's selector becomes the label
 * query that finds its pods.
 */

/** Workloads with a pod template — restart and aggregated logs apply to all three. */
export const WORKLOAD_KINDS = {
  deployment: "Deployment",
  statefulset: "StatefulSet",
  daemonset: "DaemonSet",
} as const;
export type WorkloadKind = keyof typeof WORKLOAD_KINDS;

export function parseWorkloadKind(value: string): WorkloadKind {
  if (!Object.hasOwn(WORKLOAD_KINDS, value)) {
    throw new Error(`kind must be one of ${Object.keys(WORKLOAD_KINDS).join(", ")}`);
  }
  return value as WorkloadKind;
}

/** Pods an aggregated log stream follows at most — each one is an open API request. */
export const MAX_LOG_PODS = 20;

/** `kubectl create job --from=cronjob/…` stamps this on the Job it creates. */
export const INSTANTIATE_ANNOTATION = "cronjob.kubernetes.io/instantiate";

interface LabelSelectorLike {
  matchLabels?: Record<string, string>;
  matchExpressions?: Array<{ key: string; operator: string; values?: string[] }>;
}

/**
 * A LabelSelector object → the `labelSelector` query string. An empty selector
 * would match every pod in the namespace, so it is refused rather than sent.
 */
export function selectorToString(sel: LabelSelectorLike | undefined): string {
  const parts = Object.entries(sel?.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`);
  for (const e of sel?.matchExpressions ?? []) {
    const vals = (e.values ?? []).join(",");
    if (e.operator === "In") parts.push(`${e.key} in (${vals})`);
    else if (e.operator === "NotIn") parts.push(`${e.key} notin (${vals})`);
    else if (e.operator === "Exists") parts.push(e.key);
    else if (e.operator === "DoesNotExist") parts.push(`!${e.key}`);
    else throw new Error(`unsupported selector operator ${e.operator}`);
  }
  if (parts.length === 0) throw new Error("workload has an empty selector");
  return parts.join(",");
}

/** Number of tag colours the log overlay cycles through. */
export const POD_COLOR_COUNT = 8;

/** Stable colour slot for a pod name, so a pod keeps its colour across reconnects. */
export function podColor(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % POD_COLOR_COUNT;
}

interface CronJobLike {
  metadata?: { name?: string; namespace?: string; uid?: string };
  spec?: {
    jobTemplate?: {
      metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
      spec?: unknown;
    };
  };
}

/**
 * The Job `kubectl create job --from=cronjob/<name>` creates: the CronJob's
 * jobTemplate, owned by the CronJob (so it is garbage-collected with it) and
 * marked as a manual run. Job names cap at 63 chars; the suffix is kept whole.
 */
export function jobFromCronJob(cj: CronJobLike, suffix: string) {
  const name = cj.metadata?.name ?? "";
  const tail = `-manual-${suffix}`;
  const tpl = cj.spec?.jobTemplate ?? {};
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: name.slice(0, 63 - tail.length) + tail,
      namespace: cj.metadata?.namespace,
      labels: { ...(tpl.metadata?.labels ?? {}) },
      annotations: { ...(tpl.metadata?.annotations ?? {}), [INSTANTIATE_ANNOTATION]: "manual" },
      ownerReferences: [
        {
          apiVersion: "batch/v1",
          kind: "CronJob",
          name,
          uid: cj.metadata?.uid ?? "",
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    spec: tpl.spec,
  };
}
