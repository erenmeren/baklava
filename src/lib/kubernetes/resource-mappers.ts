/**
 * Cluster object → table row for the autoscaling, access, policy and storage
 * kinds. Pure and structurally typed like ./workload-mappers.ts. None of these
 * kinds carries secret material; a ServiceAccount row counts its Secret
 * references and never resolves them.
 */
import { secondsSince } from "./quantity";
import type {
  HpaRow,
  LimitRangeRow,
  NetworkPolicyRow,
  PdbRow,
  PvRow,
  ReplicaSetRow,
  ResourceQuotaRow,
  RoleBindingRow,
  RoleRow,
  ServiceAccountRow,
  StorageClassRow,
} from "./row-types";

const DASH = "—";

interface Meta {
  name?: string;
  namespace?: string;
  creationTimestamp?: string | Date;
  annotations?: Record<string, string>;
  ownerReferences?: Array<{ kind?: string; name?: string; controller?: boolean }>;
}

interface Common {
  metadata?: Meta;
}

function nsBase(o: Common, now: Date) {
  return {
    namespace: o.metadata?.namespace ?? "default",
    name: o.metadata?.name ?? DASH,
    ageSeconds: secondsSince(o.metadata?.creationTimestamp, now),
  };
}

/** Cluster-scoped kinds have no namespace; Role/Binding rows keep it when set. */
function clusterBase(o: Common, now: Date) {
  const ns = o.metadata?.namespace;
  return {
    ...(ns ? { namespace: ns } : {}),
    name: o.metadata?.name ?? DASH,
    ageSeconds: secondsSince(o.metadata?.creationTimestamp, now),
  };
}

function selectorString(sel: { matchLabels?: Record<string, string> } | undefined): string {
  const labels = Object.entries(sel?.matchLabels ?? {});
  return labels.length ? labels.map(([k, v]) => `${k}=${v}`).join(",") : "<all>";
}

const ACCESS_MODES: Record<string, string> = {
  ReadWriteOnce: "RWO",
  ReadOnlyMany: "ROX",
  ReadWriteMany: "RWX",
  ReadWriteOncePod: "RWOP",
};

// ── HorizontalPodAutoscaler (autoscaling/v2) ────────────────────────────────

interface MetricTarget {
  type?: string;
  averageUtilization?: number;
  averageValue?: string;
  value?: string;
}
interface MetricValue {
  averageUtilization?: number;
  averageValue?: string;
  value?: string;
}
interface MetricSpec {
  type?: string;
  resource?: { name?: string; target?: MetricTarget };
  containerResource?: { name?: string; container?: string; target?: MetricTarget };
  pods?: { metric?: { name?: string }; target?: MetricTarget };
  object?: { metric?: { name?: string }; target?: MetricTarget };
  external?: { metric?: { name?: string }; target?: MetricTarget };
}
interface MetricStatus {
  type?: string;
  resource?: { name?: string; current?: MetricValue };
  containerResource?: { name?: string; current?: MetricValue };
  pods?: { metric?: { name?: string }; current?: MetricValue };
  object?: { metric?: { name?: string }; current?: MetricValue };
  external?: { metric?: { name?: string }; current?: MetricValue };
}

type MetricKey = "resource" | "containerResource" | "pods" | "object" | "external";
const METRIC_KEY: Record<string, MetricKey> = {
  Resource: "resource",
  ContainerResource: "containerResource",
  Pods: "pods",
  Object: "object",
  External: "external",
};

function metricName(m: MetricSpec | MetricStatus, key: MetricKey): string {
  const part = m[key] as { name?: string; metric?: { name?: string } } | undefined;
  return part?.name ?? part?.metric?.name ?? "?";
}

function fmt(v: MetricValue | MetricTarget | undefined, percent: boolean): string | undefined {
  if (!v) return undefined;
  if (percent) return v.averageUtilization !== undefined ? `${v.averageUtilization}%` : undefined;
  return v.averageValue ?? v.value;
}

/** kubectl's TARGETS column: "cpu 45%/80%", "<unknown>" before metrics arrive. */
export function hpaMetricsSummary(specs: MetricSpec[], statuses: MetricStatus[]): string {
  if (!specs.length) return DASH;
  return specs
    .map((m) => {
      const key = METRIC_KEY[m.type ?? ""];
      if (!key) return m.type ?? "?";
      const name = metricName(m, key);
      const target = (m[key] as { target?: MetricTarget } | undefined)?.target;
      const percent = target?.type === "Utilization";
      const status = statuses.find((s) => s.type === m.type && metricName(s, key) === name);
      const current = fmt((status?.[key] as { current?: MetricValue } | undefined)?.current, percent);
      return `${name} ${current ?? "<unknown>"}/${fmt(target, percent) ?? "?"}`;
    })
    .join(", ");
}

export function mapHpa(
  hpa: Common & {
    spec?: {
      scaleTargetRef?: { kind?: string; name?: string };
      minReplicas?: number;
      maxReplicas?: number;
      metrics?: MetricSpec[];
    };
    status?: { currentReplicas?: number; desiredReplicas?: number; currentMetrics?: MetricStatus[] };
  },
  now: Date = new Date(),
): HpaRow {
  const ref = hpa.spec?.scaleTargetRef;
  return {
    ...nsBase(hpa, now),
    target: ref ? `${ref.kind ?? "?"}/${ref.name ?? "?"}` : DASH,
    // The API defaults minReplicas to 1 when unset.
    minReplicas: hpa.spec?.minReplicas ?? 1,
    maxReplicas: hpa.spec?.maxReplicas ?? 0,
    current: hpa.status?.currentReplicas ?? 0,
    desired: hpa.status?.desiredReplicas ?? 0,
    metrics: hpaMetricsSummary(hpa.spec?.metrics ?? [], hpa.status?.currentMetrics ?? []),
  };
}

// ── ReplicaSet ──────────────────────────────────────────────────────────────

export function mapReplicaSet(
  rs: Common & {
    spec?: { replicas?: number; template?: { spec?: { containers?: Array<{ image?: string }> } } };
    status?: { replicas?: number; readyReplicas?: number };
  },
  now: Date = new Date(),
): ReplicaSetRow {
  const owner = rs.metadata?.ownerReferences?.find((o) => o.controller) ?? rs.metadata?.ownerReferences?.[0];
  const images = (rs.spec?.template?.spec?.containers ?? []).map((c) => c.image).filter(Boolean);
  return {
    ...nsBase(rs, now),
    owner: owner ? `${owner.kind}/${owner.name}` : DASH,
    desired: rs.spec?.replicas ?? 0,
    current: rs.status?.replicas ?? 0,
    ready: rs.status?.readyReplicas ?? 0,
    images: images.length ? images.join(",") : DASH,
  };
}

// ── Access: ServiceAccount, Role/ClusterRole, RoleBinding/ClusterRoleBinding ─

export function mapServiceAccount(
  sa: Common & { secrets?: unknown[] },
  now: Date = new Date(),
): ServiceAccountRow {
  return { ...nsBase(sa, now), secrets: sa.secrets?.length ?? 0 };
}

interface PolicyRule {
  verbs?: string[];
  resources?: string[];
  nonResourceURLs?: string[];
}

/** "get,list pods,services; * deployments" — one clause per rule. */
export function rulesSummary(rules: PolicyRule[]): string {
  if (!rules.length) return DASH;
  return rules
    .map((r) => {
      const verbs = (r.verbs ?? []).join(",") || "?";
      const on = [...(r.resources ?? []), ...(r.nonResourceURLs ?? [])].join(",") || "?";
      return `${verbs} ${on}`;
    })
    .join("; ");
}

export function mapRole(
  role: Common & { rules?: PolicyRule[] | null },
  now: Date = new Date(),
): RoleRow {
  const rules = role.rules ?? [];
  return { ...clusterBase(role, now), rules: rules.length, summary: rulesSummary(rules) };
}

export function mapRoleBinding(
  rb: Common & {
    roleRef?: { kind?: string; name?: string };
    subjects?: Array<{ kind?: string; name?: string; namespace?: string }> | null;
  },
  now: Date = new Date(),
): RoleBindingRow {
  const subjects = (rb.subjects ?? []).map((s) =>
    [s.kind ?? "?", ...(s.namespace ? [s.namespace] : []), s.name ?? "?"].join("/"),
  );
  return {
    ...clusterBase(rb, now),
    role: rb.roleRef ? `${rb.roleRef.kind}/${rb.roleRef.name}` : DASH,
    subjects: subjects.length ? subjects.join(", ") : DASH,
  };
}

// ── NetworkPolicy ───────────────────────────────────────────────────────────

export function mapNetworkPolicy(
  np: Common & {
    spec?: {
      podSelector?: { matchLabels?: Record<string, string> };
      policyTypes?: string[];
      ingress?: unknown[];
      egress?: unknown[];
    };
  },
  now: Date = new Date(),
): NetworkPolicyRow {
  return {
    ...nsBase(np, now),
    podSelector: selectorString(np.spec?.podSelector),
    // The API server defaults policyTypes; an unset list means Ingress.
    policyTypes: (np.spec?.policyTypes ?? ["Ingress"]).join(","),
    ingressRules: np.spec?.ingress?.length ?? 0,
    egressRules: np.spec?.egress?.length ?? 0,
  };
}

// ── Storage: PersistentVolume, StorageClass ─────────────────────────────────

export function mapPv(
  pv: Common & {
    spec?: {
      capacity?: { storage?: string };
      accessModes?: string[];
      persistentVolumeReclaimPolicy?: string;
      storageClassName?: string;
      claimRef?: { namespace?: string; name?: string };
    };
    status?: { phase?: string };
  },
  now: Date = new Date(),
): PvRow {
  const claim = pv.spec?.claimRef;
  return {
    ...clusterBase(pv, now),
    capacity: pv.spec?.capacity?.storage ?? DASH,
    accessModes: (pv.spec?.accessModes ?? []).map((m) => ACCESS_MODES[m] ?? m).join(",") || DASH,
    reclaimPolicy: pv.spec?.persistentVolumeReclaimPolicy ?? DASH,
    status: pv.status?.phase ?? "Unknown",
    claim: claim?.name ? `${claim.namespace ?? ""}/${claim.name}` : DASH,
    storageClass: pv.spec?.storageClassName || DASH,
  };
}

const DEFAULT_CLASS = [
  "storageclass.kubernetes.io/is-default-class",
  "storageclass.beta.kubernetes.io/is-default-class",
];

export function mapStorageClass(
  sc: Common & {
    provisioner?: string;
    reclaimPolicy?: string;
    volumeBindingMode?: string;
    allowVolumeExpansion?: boolean;
  },
  now: Date = new Date(),
): StorageClassRow {
  const annotations = sc.metadata?.annotations ?? {};
  return {
    ...clusterBase(sc, now),
    provisioner: sc.provisioner ?? DASH,
    isDefault: DEFAULT_CLASS.some((a) => annotations[a] === "true"),
    // Both are API defaults when the manifest leaves them out.
    reclaimPolicy: sc.reclaimPolicy ?? "Delete",
    bindingMode: sc.volumeBindingMode ?? "Immediate",
    allowExpansion: sc.allowVolumeExpansion === true,
  };
}

// ── PodDisruptionBudget ─────────────────────────────────────────────────────

export function mapPdb(
  pdb: Common & {
    spec?: { minAvailable?: number | string; maxUnavailable?: number | string };
    status?: { currentHealthy?: number; desiredHealthy?: number; disruptionsAllowed?: number };
  },
  now: Date = new Date(),
): PdbRow {
  return {
    ...nsBase(pdb, now),
    minAvailable: pdb.spec?.minAvailable !== undefined ? String(pdb.spec.minAvailable) : "N/A",
    maxUnavailable: pdb.spec?.maxUnavailable !== undefined ? String(pdb.spec.maxUnavailable) : "N/A",
    currentHealthy: pdb.status?.currentHealthy ?? 0,
    desiredHealthy: pdb.status?.desiredHealthy ?? 0,
    disruptionsAllowed: pdb.status?.disruptionsAllowed ?? 0,
  };
}

// ── ResourceQuota, LimitRange ───────────────────────────────────────────────

export function mapResourceQuota(
  rq: Common & { status?: { hard?: Record<string, string>; used?: Record<string, string> } },
  now: Date = new Date(),
): ResourceQuotaRow {
  const hard = rq.status?.hard ?? {};
  const used = rq.status?.used ?? {};
  const usage = Object.keys(hard)
    .sort()
    .map((k) => `${k} ${used[k] ?? "0"}/${hard[k]}`);
  return { ...nsBase(rq, now), usage: usage.length ? usage.join(", ") : DASH };
}

type ResourceMap = Record<string, string> | undefined;

function pairs(m: ResourceMap): string {
  return Object.entries(m ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

export function mapLimitRange(
  lr: Common & {
    spec?: {
      limits?: Array<{
        type?: string;
        default?: ResourceMap;
        defaultRequest?: ResourceMap;
        max?: ResourceMap;
        min?: ResourceMap;
      }>;
    };
  },
  now: Date = new Date(),
): LimitRangeRow {
  const parts = (lr.spec?.limits ?? []).map((l) => {
    const fields = (["default", "defaultRequest", "max", "min"] as const)
      .map((f) => (pairs(l[f]) ? `${f} ${pairs(l[f])}` : ""))
      .filter(Boolean);
    return [l.type ?? "?", ...fields].join(" ");
  });
  return { ...nsBase(lr, now), limits: parts.length ? parts.join("; ") : DASH };
}
