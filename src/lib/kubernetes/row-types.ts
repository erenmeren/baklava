/**
 * Row shapes rendered by the k8s workspace tables, plus the age formatter they
 * share. `src/lib/connections/kubernetes.ts` produces these from the live
 * cluster. Ages are seconds, rendered relatively on the client.
 */

export type PodPhase =
  | "Running"
  | "Pending"
  | "Succeeded"
  | "Failed"
  | "Unknown"
  | "Terminating"
  | "CrashLoopBackOff"
  | "ImagePullBackOff"
  | "ContainerCreating"
  | "Init"
  | "Completed"
  | "Error";

export interface PodRow {
  namespace: string;
  name: string;
  ready: string; // "1/1", "0/2"
  status: PodPhase;
  restarts: number;
  lastRestart?: string; // human "3m ago"
  ip: string;
  node: string;
  ageSeconds: number;
  cpu: string; // "12m"
  mem: string; // "84Mi"
  qos: "Guaranteed" | "Burstable" | "BestEffort";
}

export interface DeploymentRow {
  namespace: string;
  name: string;
  ready: string; // "3/3"
  upToDate: number;
  available: number;
  ageSeconds: number;
  image: string;
  selector: string;
}

export interface ServiceRow {
  namespace: string;
  name: string;
  type: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName" | "Headless";
  clusterIP: string;
  externalIP: string;
  ports: string;
  ageSeconds: number;
  selector: string;
}

export interface ConfigMapRow {
  namespace: string;
  name: string;
  dataKeys: number;
  ageSeconds: number;
  labels: string;
}

export interface SecretRow {
  namespace: string;
  name: string;
  type:
    | "Opaque"
    | "kubernetes.io/dockerconfigjson"
    | "kubernetes.io/tls"
    | "kubernetes.io/service-account-token";
  dataKeys: number;
  ageSeconds: number;
}

export interface NamespaceRow {
  name: string;
  status: "Active" | "Terminating";
  ageSeconds: number;
  pods: number;
  labels: string;
}

export interface NodeRow {
  name: string;
  /** `kubectl get nodes` STATUS — "Ready", "NotReady,SchedulingDisabled", … */
  status: string;
  schedulable: boolean;
  roles: string;
  version: string;
  os: string;
  internalIP: string;
  cpu: string;
  memory: string;
  podCapacity: number;
  ageSeconds: number;
}

export interface EventRow {
  namespace: string;
  name: string;
  type: "Normal" | "Warning";
  reason: string;
  /** The object the event is about, as "Kind/name". */
  object: string;
  message: string;
  count: number;
  /** Seconds since the event was *last* seen, not since it was created. */
  ageSeconds: number;
}

export interface StatefulSetRow {
  namespace: string;
  name: string;
  ready: string; // "2/3"
  service: string;
  image: string;
  ageSeconds: number;
}

export interface DaemonSetRow {
  namespace: string;
  name: string;
  desired: number;
  current: number;
  ready: number;
  upToDate: number;
  available: number;
  image: string;
  ageSeconds: number;
}

export interface JobRow {
  namespace: string;
  name: string;
  status: "Complete" | "Failed" | "Running" | "Pending";
  completions: string; // "3/3"
  failed: number;
  duration: string;
  image: string;
  ageSeconds: number;
}

export interface CronJobRow {
  namespace: string;
  name: string;
  schedule: string;
  suspend: boolean;
  active: number;
  /** Seconds since the last run, or null when it has never fired. */
  lastScheduleSeconds: number | null;
  image: string;
  ageSeconds: number;
}

export interface IngressRow {
  namespace: string;
  name: string;
  className: string;
  hosts: string;
  paths: string;
  address: string;
  ageSeconds: number;
}

export interface PvcRow {
  namespace: string;
  name: string;
  status: string;
  volume: string;
  capacity: string;
  accessModes: string;
  storageClass: string;
  ageSeconds: number;
}

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
