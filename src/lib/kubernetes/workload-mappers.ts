/**
 * Cluster object → table row for the workload, network and storage kinds.
 * Pure, structurally typed and cluster-free, like ./mappers.ts — see that
 * file's header for why the mapping doesn't live in the driver.
 */
import { humanQuantity, secondsSince } from "./quantity";
import type {
  CronJobRow,
  DaemonSetRow,
  IngressRow,
  JobRow,
  PvcRow,
  StatefulSetRow,
} from "./row-types";

const DASH = "—";

interface Meta {
  name?: string;
  namespace?: string;
  creationTimestamp?: string | Date;
}

interface PodTemplate {
  spec?: { containers?: Array<{ image?: string }> };
}

interface Common {
  metadata?: Meta;
}

function base(o: Common, now: Date) {
  return {
    namespace: o.metadata?.namespace ?? "default",
    name: o.metadata?.name ?? DASH,
    ageSeconds: secondsSince(o.metadata?.creationTimestamp, now),
  };
}

/** First container's image — the one people scan a workload list for. */
function firstImage(template: PodTemplate | undefined): string {
  return template?.spec?.containers?.[0]?.image ?? DASH;
}

/** Compact duration, matching the age formatter's vocabulary. */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function mapStatefulSet(
  sts: Common & {
    spec?: { replicas?: number; serviceName?: string; template?: PodTemplate };
    status?: { readyReplicas?: number };
  },
  now: Date = new Date(),
): StatefulSetRow {
  const desired = sts.spec?.replicas ?? 0;
  return {
    ...base(sts, now),
    ready: `${sts.status?.readyReplicas ?? 0}/${desired}`,
    service: sts.spec?.serviceName ?? DASH,
    image: firstImage(sts.spec?.template),
  };
}

export function mapDaemonSet(
  ds: Common & {
    spec?: { template?: PodTemplate };
    status?: {
      desiredNumberScheduled?: number;
      currentNumberScheduled?: number;
      numberReady?: number;
      numberAvailable?: number;
      updatedNumberScheduled?: number;
    };
  },
  now: Date = new Date(),
): DaemonSetRow {
  const st = ds.status ?? {};
  return {
    ...base(ds, now),
    desired: st.desiredNumberScheduled ?? 0,
    current: st.currentNumberScheduled ?? 0,
    ready: st.numberReady ?? 0,
    upToDate: st.updatedNumberScheduled ?? 0,
    available: st.numberAvailable ?? 0,
    image: firstImage(ds.spec?.template),
  };
}

export function mapJob(
  job: Common & {
    spec?: { completions?: number; template?: PodTemplate };
    status?: {
      succeeded?: number;
      failed?: number;
      startTime?: string | Date;
      completionTime?: string | Date;
    };
  },
  now: Date = new Date(),
): JobRow {
  const st = job.status ?? {};
  const desired = job.spec?.completions ?? 1;
  const succeeded = st.succeeded ?? 0;
  const failed = st.failed ?? 0;
  const status =
    succeeded >= desired
      ? "Complete"
      : failed > 0 && succeeded === 0
        ? "Failed"
        : st.startTime
          ? "Running"
          : "Pending";
  // A finished job's duration is start→completion; a running one is measured
  // against now, which is what `kubectl get jobs` shows.
  const started = st.startTime ? secondsSince(st.startTime, now) : null;
  const ran =
    started === null
      ? DASH
      : st.completionTime
        ? duration(started - secondsSince(st.completionTime, now))
        : duration(started);
  return {
    ...base(job, now),
    status,
    completions: `${succeeded}/${desired}`,
    failed,
    duration: ran,
    image: firstImage(job.spec?.template),
  };
}

export function mapCronJob(
  cron: Common & {
    spec?: {
      schedule?: string;
      suspend?: boolean;
      jobTemplate?: { spec?: { template?: PodTemplate } };
    };
    status?: { active?: unknown[]; lastScheduleTime?: string | Date };
  },
  now: Date = new Date(),
): CronJobRow {
  return {
    ...base(cron, now),
    schedule: cron.spec?.schedule ?? DASH,
    suspend: cron.spec?.suspend === true,
    active: cron.status?.active?.length ?? 0,
    lastScheduleSeconds: cron.status?.lastScheduleTime
      ? secondsSince(cron.status.lastScheduleTime, now)
      : null,
    image: firstImage(cron.spec?.jobTemplate?.spec?.template),
  };
}

export function mapIngress(
  ing: Common & {
    spec?: {
      ingressClassName?: string;
      rules?: Array<{ host?: string; http?: { paths?: Array<{ path?: string }> } }>;
    };
    status?: { loadBalancer?: { ingress?: Array<{ ip?: string; hostname?: string }> } };
  },
  now: Date = new Date(),
): IngressRow {
  const rules = ing.spec?.rules ?? [];
  const hosts = rules.map((r) => r.host).filter(Boolean) as string[];
  const paths = rules.flatMap((r) => (r.http?.paths ?? []).map((p) => p.path ?? "/"));
  const lb = ing.status?.loadBalancer?.ingress?.[0];
  return {
    ...base(ing, now),
    className: ing.spec?.ingressClassName || "<none>",
    hosts: hosts.length ? hosts.join(",") : DASH,
    paths: paths.length ? paths.join(",") : DASH,
    address: lb?.ip || lb?.hostname || DASH,
  };
}

/** kubectl's access-mode abbreviations. */
const ACCESS_MODES: Record<string, string> = {
  ReadWriteOnce: "RWO",
  ReadOnlyMany: "ROX",
  ReadWriteMany: "RWX",
  ReadWriteOncePod: "RWOP",
};

export function mapPvc(
  pvc: Common & {
    spec?: {
      storageClassName?: string;
      accessModes?: string[];
      volumeName?: string;
      resources?: { requests?: { storage?: string } };
    };
    status?: { phase?: string; capacity?: { storage?: string } };
  },
  now: Date = new Date(),
): PvcRow {
  const modes = (pvc.spec?.accessModes ?? []).map((m) => ACCESS_MODES[m] ?? m);
  // Bound claims report their real capacity; a Pending one has only a request.
  const size = pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage;
  return {
    ...base(pvc, now),
    status: pvc.status?.phase ?? "Unknown",
    volume: pvc.spec?.volumeName ?? DASH,
    capacity: humanQuantity(size),
    accessModes: modes.length ? modes.join(",") : DASH,
    storageClass: pvc.spec?.storageClassName || "<none>",
  };
}
