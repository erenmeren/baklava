import { z } from "zod";
import type { TechModule } from "@/techs/contract";
import type { KubernetesConfig, ConnectionRecord } from "@/lib/connections/types";
import { probe as probeKubernetes } from "@/lib/connections/kubernetes";

const schema = z.object({
  source: z.enum(["path", "inline"]),
  kubeconfigPath: z.string().optional(),
  kubeconfigYaml: z.string().optional(),
  context: z.string().optional(),
  namespace: z.string().optional(),
});

export const kubernetes: TechModule<KubernetesConfig> = {
  id: "kubernetes",
  catalog: {
    id: "kubernetes",
    name: "Kubernetes",
    tagline: "Container orchestrator",
    description:
      "k9s-inspired terminal-style browser for pods, deployments, services and more.",
    category: "Orchestration",
    color: "from-cyan-400 to-blue-700",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<KubernetesConfig>, secretKeys: ["kubeconfigYaml"] },
  driver: { probe: (c) => probeKubernetes("probe", c) },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as KubernetesConfig;
    const where =
      cfg.source === "inline"
        ? "inline kubeconfig"
        : cfg.kubeconfigPath || "~/.kube/config";
    const ctx = cfg.context ? `· ${cfg.context}` : "";
    const ns = cfg.namespace ? `· ns=${cfg.namespace}` : "";
    return `${where} ${ctx} ${ns}`.replace(/\s+/g, " ").trim();
  },
  firstPage: "pods",
  optionalDeps: ["@kubernetes/client-node"],
  serverPackages: ["@kubernetes/client-node"],
  capabilities: { browse: true, health: true },
};
