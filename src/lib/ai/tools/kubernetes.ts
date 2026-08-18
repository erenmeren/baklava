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
  replaceResourceYaml,
  deleteResource,
  describeResource,
  scaleDeployment,
  restartDeployment,
} from "@/lib/connections/kubernetes";
import type { AiTool } from "./types";

// Mirrors KIND_MAP in the driver — every kind the workspace can read, edit or
// delete is a kind the assistant can name.
const KIND = z.enum([
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
      name: "k8s_scale_deployment",
      description: "Set a deployment's replica count. Scaling to 0 stops every pod it owns.",
      category: "write",
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
      name: "k8s_apply_yaml",
      description:
        "Apply (full PUT replace) a resource from a complete YAML manifest. Do NOT submit a Secret manifest obtained from k8s_get_yaml when its values were redacted — it would erase the Secret's data.",
      category: "write",
      inputSchema: z.object({ yaml: z.string() }),
      execute: async ({ yaml }) => {
        await replaceResourceYaml(connectionId, config, yaml as string);
        return { ok: true };
      },
    },
    {
      name: "k8s_delete_resource",
      description: "Delete a resource. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({ kind: KIND, namespace: z.string().optional(), name: z.string() }),
      execute: async ({ kind, namespace, name }) => {
        await deleteResource(connectionId, config, kind as string, namespace as string | undefined, name as string);
        return { ok: true, deleted: `${kind}/${name}` };
      },
    },
  ];
}
