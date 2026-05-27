import type {
  ConnectionRecord,
  DockerConfig,
  KafkaConfig,
  KubernetesConfig,
  PostgresConfig,
  SqlServerConfig,
  TechId,
} from "./types";

export const connectionSummaries: Record<
  TechId,
  (r: ConnectionRecord) => string
> = {
  docker: (r) => {
    const cfg = r.config as DockerConfig;
    return cfg.mode === "tcp"
      ? `${cfg.protocol}://${cfg.host}:${cfg.port}`
      : `socket: ${cfg.socketPath}`;
  },
  postgres: (r) => {
    const cfg = r.config as PostgresConfig;
    return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  },
  kafka: (r) => {
    const cfg = r.config as KafkaConfig;
    return cfg.brokers.join(", ");
  },
  sqlserver: (r) => {
    const cfg = r.config as SqlServerConfig;
    return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  },
  kubernetes: (r) => {
    const cfg = r.config as KubernetesConfig;
    const where =
      cfg.source === "inline"
        ? "inline kubeconfig"
        : cfg.kubeconfigPath || "~/.kube/config";
    const ctx = cfg.context ? `· ${cfg.context}` : "";
    const ns = cfg.namespace ? `· ns=${cfg.namespace}` : "";
    return `${where} ${ctx} ${ns}`.replace(/\s+/g, " ").trim();
  },
};
