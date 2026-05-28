import type {
  ConnectionRecord,
  DockerConfig,
  KafkaConfig,
  KubernetesConfig,
  PostgresConfig,
  RedisConfig,
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
  redis: (r) => {
    const cfg = r.config as RedisConfig;
    const proto = cfg.tls ? "rediss" : "redis";
    if (cfg.mode === "cluster") {
      return `${proto}-cluster · ${(cfg.nodes ?? "").split(",").length} seed nodes`;
    }
    const auth = cfg.username ? `${cfg.username}@` : "";
    const db = typeof cfg.db === "number" && cfg.db > 0 ? `/${cfg.db}` : "";
    return `${proto}://${auth}${cfg.host ?? ""}:${cfg.port ?? 6379}${db}`;
  },
};
