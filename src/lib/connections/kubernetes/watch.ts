import "server-only";
import type { KubernetesObject, KubernetesListObject } from "@kubernetes/client-node";
import type { KubernetesConfig } from "../types";
import {
  bundleFor,
  getK8s,
  mapConfigMap,
  mapDeployment,
  mapNamespace,
  mapPod,
  mapSecret,
  mapService,
} from "@/lib/connections/kubernetes";
import { mapEvent, mapNode } from "@/lib/kubernetes/mappers";
import {
  mapCronJob,
  mapDaemonSet,
  mapIngress,
  mapJob,
  mapPvc,
  mapStatefulSet,
} from "@/lib/kubernetes/workload-mappers";
import {
  mapHpa,
  mapLimitRange,
  mapNetworkPolicy,
  mapPdb,
  mapPv,
  mapReplicaSet,
  mapResourceQuota,
  mapRole,
  mapRoleBinding,
  mapServiceAccount,
  mapStorageClass,
} from "@/lib/kubernetes/resource-mappers";
import { mapCrd } from "@/lib/kubernetes/crd";
import { LIST_LIMIT, toList, type K8sList } from "@/lib/kubernetes/list";
import { ALL_NAMESPACES } from "@/lib/kubernetes/namespace";
import { rowKey, type KeyedRow, type WatchReset } from "@/lib/kubernetes/watch-merge";

/**
 * Live list updates through the Kubernetes Watch API.
 *
 * One list (bounded by LIST_LIMIT, like the page) seeds a `reset`; a watch
 * from that list's resourceVersion streams the changes after it, so nothing
 * between the two is missed. Every object is run through the same mapper the
 * page uses — raw objects never leave the server, which is what keeps Secret
 * values out of the browser.
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- watch objects are raw JSON fed to the typed mappers */
interface WatchSpec {
  apiVersion: string;
  kind: string;
  /** Plural URL segment of the list endpoint. */
  plural: string;
  namespaced: boolean;
  map: (obj: any, now: Date) => KeyedRow;
  /** Row fields the watch can't fill (see WatchReset.keep). */
  keep?: string[];
  newestFirst?: boolean;
}

/** Keyed by the K8S_RESOURCES path — one entry per workspace list. */
export const WATCH_SPECS: Record<string, WatchSpec> = {
  pods: { apiVersion: "v1", kind: "Pod", plural: "pods", namespaced: true, map: (o) => mapPod(o), keep: ["cpuUsage", "memUsage"] },
  deployments: { apiVersion: "apps/v1", kind: "Deployment", plural: "deployments", namespaced: true, map: (o) => mapDeployment(o) },
  statefulsets: { apiVersion: "apps/v1", kind: "StatefulSet", plural: "statefulsets", namespaced: true, map: mapStatefulSet },
  daemonsets: { apiVersion: "apps/v1", kind: "DaemonSet", plural: "daemonsets", namespaced: true, map: mapDaemonSet },
  jobs: { apiVersion: "batch/v1", kind: "Job", plural: "jobs", namespaced: true, map: mapJob },
  cronjobs: { apiVersion: "batch/v1", kind: "CronJob", plural: "cronjobs", namespaced: true, map: mapCronJob },
  services: { apiVersion: "v1", kind: "Service", plural: "services", namespaced: true, map: (o) => mapService(o) },
  ingresses: { apiVersion: "networking.k8s.io/v1", kind: "Ingress", plural: "ingresses", namespaced: true, map: mapIngress },
  configmaps: { apiVersion: "v1", kind: "ConfigMap", plural: "configmaps", namespaced: true, map: (o) => mapConfigMap(o) },
  secrets: { apiVersion: "v1", kind: "Secret", plural: "secrets", namespaced: true, map: (o) => mapSecret(o) },
  pvcs: { apiVersion: "v1", kind: "PersistentVolumeClaim", plural: "persistentvolumeclaims", namespaced: true, map: mapPvc },
  namespaces: { apiVersion: "v1", kind: "Namespace", plural: "namespaces", namespaced: false, map: (o) => mapNamespace(o, new Map()), keep: ["pods"] },
  nodes: { apiVersion: "v1", kind: "Node", plural: "nodes", namespaced: false, map: (o, now) => mapNode(o, now), keep: ["cpuUsage", "memUsage", "cpuPercent", "memPercent"] },
  events: { apiVersion: "v1", kind: "Event", plural: "events", namespaced: true, map: mapEvent, newestFirst: true },
  replicasets: { apiVersion: "apps/v1", kind: "ReplicaSet", plural: "replicasets", namespaced: true, map: mapReplicaSet },
  hpas: { apiVersion: "autoscaling/v2", kind: "HorizontalPodAutoscaler", plural: "horizontalpodautoscalers", namespaced: true, map: mapHpa },
  pdbs: { apiVersion: "policy/v1", kind: "PodDisruptionBudget", plural: "poddisruptionbudgets", namespaced: true, map: mapPdb },
  resourcequotas: { apiVersion: "v1", kind: "ResourceQuota", plural: "resourcequotas", namespaced: true, map: mapResourceQuota },
  limitranges: { apiVersion: "v1", kind: "LimitRange", plural: "limitranges", namespaced: true, map: mapLimitRange },
  networkpolicies: { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", plural: "networkpolicies", namespaced: true, map: mapNetworkPolicy },
  pvs: { apiVersion: "v1", kind: "PersistentVolume", plural: "persistentvolumes", namespaced: false, map: mapPv },
  storageclasses: { apiVersion: "storage.k8s.io/v1", kind: "StorageClass", plural: "storageclasses", namespaced: false, map: mapStorageClass },
  serviceaccounts: { apiVersion: "v1", kind: "ServiceAccount", plural: "serviceaccounts", namespaced: true, map: mapServiceAccount },
  roles: { apiVersion: "rbac.authorization.k8s.io/v1", kind: "Role", plural: "roles", namespaced: true, map: mapRole },
  rolebindings: { apiVersion: "rbac.authorization.k8s.io/v1", kind: "RoleBinding", plural: "rolebindings", namespaced: true, map: mapRoleBinding },
  clusterroles: { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRole", plural: "clusterroles", namespaced: false, map: mapRole },
  clusterrolebindings: { apiVersion: "rbac.authorization.k8s.io/v1", kind: "ClusterRoleBinding", plural: "clusterrolebindings", namespaced: false, map: mapRoleBinding },
  crds: { apiVersion: "apiextensions.k8s.io/v1", kind: "CustomResourceDefinition", plural: "customresourcedefinitions", namespaced: false, map: mapCrd },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The list endpoint a watch runs against — scoped like the page's list call. */
export function watchPath(spec: WatchSpec, namespace: string): string {
  const root = spec.apiVersion.includes("/") ? `/apis/${spec.apiVersion}` : `/api/${spec.apiVersion}`;
  const scoped = spec.namespaced && namespace && namespace !== ALL_NAMESPACES;
  return `${root}${scoped ? `/namespaces/${encodeURIComponent(namespace)}` : ""}/${spec.plural}`;
}

export type WatchEvent =
  | { type: "upsert"; row: KeyedRow }
  | { type: "delete"; key: string }
  | { type: "bookmark"; resourceVersion: string }
  /** 410 Gone: the resourceVersion expired — re-list, then resume. */
  | { type: "gone" }
  | { type: "error"; message: string };

/** One watch line → what the client needs, already mapped. */
export function toWatchEvent(
  spec: WatchSpec,
  phase: string,
  obj: unknown,
  now: Date = new Date(),
): WatchEvent | null {
  const o = obj as {
    metadata?: { resourceVersion?: string };
    code?: number;
    message?: string;
  } | null;
  switch (phase) {
    case "ADDED":
    case "MODIFIED":
      return { type: "upsert", row: spec.map(o, now) };
    case "DELETED":
      return { type: "delete", key: rowKey(spec.map(o, now)) };
    case "BOOKMARK":
      return o?.metadata?.resourceVersion
        ? { type: "bookmark", resourceVersion: o.metadata.resourceVersion }
        : null;
    case "ERROR":
      return o?.code === 410
        ? { type: "gone" }
        : { type: "error", message: o?.message || "watch error" };
    default:
      return null;
  }
}

/** One bounded list call through the spec — shared by the watch's reset and the pages. */
async function listWithSpec(
  b: Awaited<ReturnType<typeof bundleFor>>,
  spec: WatchSpec,
  scoped: string | undefined,
): Promise<{ out: K8sList<KeyedRow>; resourceVersion: string }> {
  const list = (await b.objects.list(
    spec.apiVersion,
    spec.kind,
    scoped,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    LIST_LIMIT,
  )) as KubernetesListObject<KubernetesObject>;
  const now = new Date();
  const out = toList(list, (o) => spec.map(o, now));
  if (spec.newestFirst) {
    out.rows.sort(
      (a, z) => (a as { ageSeconds?: number }).ageSeconds! - (z as { ageSeconds?: number }).ageSeconds!,
    );
  }
  return { out, resourceVersion: list.metadata?.resourceVersion ?? "" };
}

/**
 * The bounded page list for a catalogue path, through the same spec (and
 * mapper) the live watch uses — the kinds added after the watch share one
 * list function instead of one hand-written `list<Kind>` each.
 */
export async function listResource<T>(
  connectionId: string,
  cfg: KubernetesConfig,
  resource: string,
  namespace: string,
): Promise<K8sList<T>> {
  if (!Object.hasOwn(WATCH_SPECS, resource)) throw new Error(`Unsupported resource: ${resource}`);
  const spec = WATCH_SPECS[resource];
  const b = await bundleFor(connectionId, cfg);
  const scoped = spec.namespaced && namespace && namespace !== ALL_NAMESPACES ? namespace : undefined;
  return (await listWithSpec(b, spec, scoped)).out as K8sList<T>;
}

export interface WatchSink {
  reset: (payload: WatchReset<KeyedRow>) => void;
  upsert: (row: KeyedRow) => void;
  remove: (key: string) => void;
}

/**
 * Stream one resource's list until `signal` aborts. Resolves on abort;
 * rejects on a failure the caller should surface (the client reconnects and
 * gets a fresh `reset`, so nothing is lost by giving up here).
 */
export async function watchResource(
  connectionId: string,
  cfg: KubernetesConfig,
  resource: string,
  namespace: string,
  sink: WatchSink,
  signal: AbortSignal,
): Promise<void> {
  const spec = WATCH_SPECS[resource];
  if (!spec) throw new Error(`Unsupported resource: ${resource}`);
  const b = await bundleFor(connectionId, cfg);
  const { Watch } = await getK8s();
  const watch = new Watch(b.kc);
  const scoped = spec.namespaced && namespace !== ALL_NAMESPACES ? namespace : undefined;

  async function relist(): Promise<string> {
    const { out, resourceVersion } = await listWithSpec(b, spec, scoped);
    sink.reset({ ...out, keep: spec.keep ?? [], newestFirst: Boolean(spec.newestFirst) });
    return resourceVersion;
  }

  let current: AbortController | null = null;
  signal.addEventListener("abort", () => current?.abort(), { once: true });

  let resourceVersion = await relist();
  while (!signal.aborted) {
    let gone = false;
    let failure: string | null = null;
    const ended = await new Promise<unknown>((resolve) => {
      watch
        .watch(
          watchPath(spec, namespace),
          { resourceVersion, allowWatchBookmarks: true },
          (phase, obj) => {
            const ev = toWatchEvent(spec, phase, obj);
            if (!ev) return;
            if (ev.type === "upsert") sink.upsert(ev.row);
            else if (ev.type === "delete") sink.remove(ev.key);
            else if (ev.type === "gone") gone = true;
            else if (ev.type === "error") failure = ev.message;
            // Bookmarks and real changes both advance the resume point.
            const rv = (obj as { metadata?: { resourceVersion?: string } })?.metadata
              ?.resourceVersion;
            if (rv && ev.type !== "gone" && ev.type !== "error") resourceVersion = rv;
          },
          resolve,
        )
        .then((ac) => {
          current = ac;
          // Abort raced the request: stop it now that we hold its controller.
          if (signal.aborted) ac.abort();
        }, resolve);
    });
    if (signal.aborted) return;
    // The expiry arrives as an ERROR event, or as the response status itself.
    if (gone || (ended as { statusCode?: number } | null)?.statusCode === 410) {
      resourceVersion = await relist();
      continue;
    }
    if (failure) throw new Error(failure);
    // A non-null `ended` is a transport failure (or a non-200 such as 403).
    if (ended) throw ended;
    // null: the API server closed the watch on its timeout — resume.
  }
}
