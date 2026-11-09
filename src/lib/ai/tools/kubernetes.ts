import { z } from "zod";
import type { KubernetesConfig } from "@/lib/connections/types";
import type { PermissionPolicy } from "../permissions";
import {
  listPods,
  listDeployments,
  listServices,
  listConfigMaps,
  listSecrets,
  listNamespaces,
  listNodes,
  listEvents,
  listStatefulSets,
  listDaemonSets,
  listJobs,
  listCronJobs,
  listIngresses,
  listPvcs,
  getPodLogs,
  readResourceYaml,
  deleteResource,
  describeResource,
  proxyPodHttp,
  scaleDeployment,
  restartDeployment,
} from "@/lib/connections/kubernetes";
import { applyManifests } from "@/lib/connections/kubernetes/apply";
import { listResource } from "@/lib/connections/kubernetes/watch";
import { listCustomResources } from "@/lib/connections/kubernetes/crds";
import {
  getRollout,
  restartWorkload,
  scaleStatefulSet,
  setCronJobSuspended,
  triggerCronJob,
  undoRollout,
} from "@/lib/connections/kubernetes/workload-ops";
import type { AiTool } from "./types";

// Mirrors KIND_MAP in the driver — every kind the workspace can read, edit or
// delete is a kind the assistant can name. A custom resource is named by its
// CRD (`<plural>.<group>`); the driver resolves that against the live CRD list.
const BUILTIN_KINDS = [
  "pod",
  "deployment",
  "service",
  "configmap",
  "secret",
  "namespace",
  "node",
  "event",
  "statefulset",
  "daemonset",
  "job",
  "cronjob",
  "ingress",
  "persistentvolumeclaim",
  "horizontalpodautoscaler",
  "replicaset",
  "serviceaccount",
  "role",
  "rolebinding",
  "clusterrole",
  "clusterrolebinding",
  "networkpolicy",
  "persistentvolume",
  "storageclass",
  "poddisruptionbudget",
  "resourcequota",
  "limitrange",
] as const;
const CRD_NAME = z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "a CRD name like widgets.example.com");
// Readable kinds include CRDs themselves; deletable ones don't — deleting a
// CRD deletes every instance of it (the workspace keeps that list read-only).
const KIND = z.union([z.enum([...BUILTIN_KINDS, "customresourcedefinition"]), CRD_NAME]);
const DELETABLE_KIND = z.union([z.enum(BUILTIN_KINDS), CRD_NAME]);

// Catalogue lists without a dedicated tool go through one generic lister.
const GENERIC_LISTS = z.enum([
  "replicasets",
  "hpas",
  "pdbs",
  "resourcequotas",
  "limitranges",
  "networkpolicies",
  "pvs",
  "storageclasses",
  "serviceaccounts",
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "crds",
]);

export function kubernetesTools(
  connectionId: string,
  config: KubernetesConfig,
  policy: PermissionPolicy,
): AiTool[] {
  const ns = z.object({ namespace: z.string().optional() });
  const list = (
    name: string,
    fn: (id: string, c: KubernetesConfig, namespace?: string) => Promise<unknown>,
    label: string,
  ): AiTool => ({
    name,
    description: `List ${label} (optionally scoped to a namespace).`,
    category: "read",
    inputSchema: ns,
    execute: async ({ namespace }) => fn(connectionId, config, namespace as string | undefined),
  });
  return [
    list("k8s_list_pods", listPods, "pods"),
    list("k8s_list_deployments", listDeployments, "deployments"),
    list("k8s_list_services", listServices, "services"),
    list("k8s_list_configmaps", listConfigMaps, "config maps"),
    list("k8s_list_secrets", listSecrets, "secrets (names + key counts only)"),
    list("k8s_list_statefulsets", listStatefulSets, "stateful sets"),
    list("k8s_list_daemonsets", listDaemonSets, "daemon sets"),
    list("k8s_list_jobs", listJobs, "jobs"),
    list("k8s_list_cronjobs", listCronJobs, "cron jobs"),
    list("k8s_list_ingresses", listIngresses, "ingresses"),
    list("k8s_list_pvcs", listPvcs, "persistent volume claims"),
    list("k8s_list_events", listEvents, "events (newest first)"),
    {
      name: "k8s_list_resources",
      description:
        "List a cluster resource kind that has no dedicated list tool: replicasets, hpas, pdbs, resourcequotas, limitranges, networkpolicies, pvs, storageclasses, serviceaccounts, roles, rolebindings, clusterroles, clusterrolebindings, crds (installed CustomResourceDefinitions). Optionally scoped to a namespace.",
      category: "read",
      inputSchema: z.object({ resource: GENERIC_LISTS, namespace: z.string().optional() }),
      execute: async ({ resource, namespace }) =>
        listResource(connectionId, config, resource as string, (namespace as string | undefined) ?? ""),
    },
    {
      name: "k8s_list_custom_resources",
      description:
        "List instances of a custom resource, named by its CRD (`<plural>.<group>`, e.g. certificates.cert-manager.io — see k8s_list_resources with resource=crds). Optionally scoped to a namespace.",
      category: "read",
      inputSchema: z.object({ crd: CRD_NAME, namespace: z.string().optional() }),
      execute: async ({ crd, namespace }) => {
        const name = crd as string;
        const dot = name.indexOf(".");
        const { list } = await listCustomResources(
          connectionId,
          config,
          name.slice(dot + 1),
          name.slice(0, dot),
          (namespace as string | undefined) ?? "",
        );
        return list;
      },
    },
    {
      name: "k8s_list_nodes",
      description:
        "List cluster nodes with status, roles, version and live CPU/memory usage.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listNodes(connectionId, config),
    },
    {
      name: "k8s_list_namespaces",
      description: "List all namespaces in the cluster.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listNamespaces(connectionId, config),
    },
    {
      name: "k8s_pod_logs",
      description: "Read the last N lines of a pod's logs (one-shot, not following).",
      category: "read",
      inputSchema: z.object({
        namespace: z.string(),
        pod: z.string(),
        tailLines: z.number().int().min(1).max(2000).default(200),
        container: z.string().optional(),
      }),
      execute: async ({ namespace, pod, tailLines, container }) =>
        getPodLogs(connectionId, config, namespace as string, pod as string, {
          tailLines: tailLines as number | undefined,
          container: container as string | undefined,
        }),
    },
    {
      name: "k8s_get_yaml",
      description: "Get a resource's YAML manifest. Secret values are redacted unless this connection allows them.",
      category: "read",
      inputSchema: z.object({ kind: KIND, namespace: z.string().optional(), name: z.string() }),
      execute: async ({ kind, namespace, name }) =>
        readResourceYaml(connectionId, config, kind as string, namespace as string | undefined, name as string, {
          redactSecretValues: policy.allowK8sSecretValues !== true,
        }),
    },
    {
      name: "k8s_describe",
      description:
        "kubectl describe for one object: container state and reasons, conditions, and the object's own events. Start here when something is failing — the reason is usually in the events.",
      category: "read",
      inputSchema: z.object({ kind: KIND, namespace: z.string().optional(), name: z.string() }),
      execute: async ({ kind, namespace, name }) =>
        describeResource(
          connectionId,
          config,
          kind as string,
          namespace as string | undefined,
          name as string,
        ),
    },
    {
      name: "k8s_pod_http",
      description:
        "GET a pod's HTTP port through the apiserver proxy — health endpoints, metrics, admin pages. HTTP only: this is not a TCP tunnel, so cluster databases are not reachable. Categorised as a write because the pod decides what a GET does.",
      category: "write",
      inputSchema: z.object({
        namespace: z.string(),
        pod: z.string(),
        port: z.union([z.number().int().min(1).max(65535), z.string()]),
        path: z.string().default("/"),
      }),
      execute: async ({ namespace, pod, port, path }) =>
        proxyPodHttp(
          connectionId,
          config,
          namespace as string,
          pod as string,
          port as number | string,
          path as string,
        ),
    },
    {
      name: "k8s_scale_deployment",
      description: "Set a deployment's replica count. Scaling to 0 stops every pod it owns (DESTRUCTIVE).",
      category: "write",
      categoryFor: ({ replicas }) => (replicas === 0 ? "destructive" : "write"),
      inputSchema: z.object({
        namespace: z.string(),
        name: z.string(),
        replicas: z.number().int().min(0).max(1000),
      }),
      execute: async ({ namespace, name, replicas }) => {
        await scaleDeployment(
          connectionId,
          config,
          namespace as string,
          name as string,
          replicas as number,
        );
        return { ok: true, scaled: `${namespace}/${name}`, replicas };
      },
    },
    {
      name: "k8s_restart_deployment",
      description:
        "Roll a deployment's pods, like `kubectl rollout restart`. Every pod is replaced.",
      category: "write",
      inputSchema: z.object({ namespace: z.string(), name: z.string() }),
      execute: async ({ namespace, name }) => {
        await restartDeployment(connectionId, config, namespace as string, name as string);
        return { ok: true, restarted: `${namespace}/${name}` };
      },
    },
    {
      name: "k8s_rollout_history",
      description:
        "A deployment's rollout status (desired/updated/ready/available, Progressing condition) and revision history: each revision's images and change-cause, newest first.",
      category: "read",
      inputSchema: z.object({ namespace: z.string(), name: z.string() }),
      execute: async ({ namespace, name }) =>
        getRollout(connectionId, config, namespace as string, name as string),
    },
    {
      name: "k8s_rollout_undo",
      description:
        "Roll a deployment back to an earlier revision (kubectl rollout undo --to-revision). DESTRUCTIVE: it replaces the running pod template and every pod. Read k8s_rollout_history first.",
      // Replaces the live template wholesale — whatever the later revision
      // added (a fix, a secret mount) is gone.
      category: "destructive",
      inputSchema: z.object({
        namespace: z.string(),
        name: z.string(),
        revision: z.number().int().min(1),
      }),
      execute: async ({ namespace, name, revision }) => {
        await undoRollout(connectionId, config, namespace as string, name as string, revision as number);
        return { ok: true, rolledBack: `${namespace}/${name}`, revision };
      },
    },
    {
      name: "k8s_restart_workload",
      description:
        "Roll a StatefulSet's or DaemonSet's pods, like `kubectl rollout restart`. Every pod is replaced.",
      category: "write",
      inputSchema: z.object({
        kind: z.enum(["statefulset", "daemonset"]),
        namespace: z.string(),
        name: z.string(),
      }),
      execute: async ({ kind, namespace, name }) => {
        await restartWorkload(
          connectionId,
          config,
          kind as "statefulset" | "daemonset",
          namespace as string,
          name as string,
        );
        return { ok: true, restarted: `${kind}/${namespace}/${name}` };
      },
    },
    {
      name: "k8s_scale_statefulset",
      description: "Set a statefulset's replica count. Scaling to 0 stops every pod it owns (DESTRUCTIVE).",
      category: "write",
      categoryFor: ({ replicas }) => (replicas === 0 ? "destructive" : "write"),
      inputSchema: z.object({
        namespace: z.string(),
        name: z.string(),
        replicas: z.number().int().min(0).max(1000),
      }),
      execute: async ({ namespace, name, replicas }) => {
        await scaleStatefulSet(connectionId, config, namespace as string, name as string, replicas as number);
        return { ok: true, scaled: `${namespace}/${name}`, replicas };
      },
    },
    {
      name: "k8s_trigger_cronjob",
      description:
        "Run a cronjob now: create a Job from its job template (kubectl create job --from=cronjob/<name>). Returns the Job's name.",
      category: "write",
      inputSchema: z.object({ namespace: z.string(), name: z.string() }),
      execute: async ({ namespace, name }) => ({
        ok: true,
        job: await triggerCronJob(connectionId, config, namespace as string, name as string),
      }),
    },
    {
      name: "k8s_suspend_cronjob",
      description: "Suspend (suspend: true) or resume (suspend: false) a cronjob's schedule.",
      category: "write",
      inputSchema: z.object({ namespace: z.string(), name: z.string(), suspend: z.boolean() }),
      execute: async ({ namespace, name, suspend }) => {
        await setCronJobSuspended(connectionId, config, namespace as string, name as string, suspend as boolean);
        return { ok: true, cronjob: `${namespace}/${name}`, suspend };
      },
    },
    {
      name: "k8s_apply_yaml",
      description:
        "Server-side apply (field manager \"baklava\", no force) of one or more YAML manifests separated by `---`; creates objects that don't exist. DESTRUCTIVE: fields Baklava previously applied and the manifest omits are removed. Returns per-object created/configured/unchanged with a diff, or conflict/error. Do NOT submit a Secret manifest obtained from k8s_get_yaml when its values were redacted.",
      // An apply of *any* kind: it can rewrite a Secret, grant cluster-admin
      // through a RoleBinding, or run a privileged pod — never a routine write.
      category: "destructive",
      inputSchema: z.object({ yaml: z.string() }),
      execute: async ({ yaml }) => {
        const results = await applyManifests(connectionId, config, yaml as string, { dryRun: false });
        return { ok: results.every((r) => r.action !== "error" && r.action !== "conflict"), results };
      },
    },
    {
      name: "k8s_delete_resource",
      description: "Delete a resource. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({ kind: DELETABLE_KIND, namespace: z.string().optional(), name: z.string() }),
      execute: async ({ kind, namespace, name }) => {
        await deleteResource(connectionId, config, kind as string, namespace as string | undefined, name as string);
        return { ok: true, deleted: `${kind}/${name}` };
      },
    },
  ];
}
