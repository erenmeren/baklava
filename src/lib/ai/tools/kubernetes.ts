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
  getPodLogs,
  readResourceYaml,
  replaceResourceYaml,
  deleteResource,
} from "@/lib/connections/kubernetes";
import type { AiTool } from "./types";

const KIND = z.enum(["pod", "deployment", "service", "configmap", "secret", "namespace"]);

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
