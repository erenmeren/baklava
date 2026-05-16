import type {
  ChromaConfig,
  ClickhouseConfig,
  ConnectionRecord,
  DockerConfig,
  ElasticConfig,
  EtcdConfig,
  KafkaConfig,
  KubernetesConfig,
  MilvusConfig,
  MongoConfig,
  MysqlConfig,
  NatsConfig,
  Neo4jConfig,
  PostgresConfig,
  QdrantConfig,
  RabbitConfig,
  RedisConfig,
  SqliteConfig,
  SqlServerConfig,
  SupabaseConfig,
  TechId,
  WeaviateConfig,
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
  redis: (r) => {
    const cfg = r.config as RedisConfig;
    return `${cfg.host}:${cfg.port}/${cfg.database}`;
  },
  mysql: (r) => {
    const cfg = r.config as MysqlConfig;
    return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  },
  mongo: (r) => {
    const cfg = r.config as MongoConfig;
    if (cfg.uri) return cfg.uri;
    return `${cfg.user ?? "—"}@${cfg.host}:${cfg.port}/${cfg.database ?? ""}`;
  },
  rabbit: (r) => {
    const cfg = r.config as RabbitConfig;
    return `${cfg.user}@${cfg.host}:${cfg.port}${cfg.vhost === "/" ? "" : cfg.vhost}`;
  },
  elastic: (r) => {
    const cfg = r.config as ElasticConfig;
    return cfg.nodes.join(", ");
  },
  clickhouse: (r) => {
    const cfg = r.config as ClickhouseConfig;
    return `${cfg.user}@${cfg.url}/${cfg.database}`;
  },
  nats: (r) => {
    const cfg = r.config as NatsConfig;
    return cfg.servers.join(", ");
  },
  sqlite: (r) => {
    const cfg = r.config as SqliteConfig;
    return cfg.filePath;
  },
  etcd: (r) => {
    const cfg = r.config as EtcdConfig;
    return cfg.hosts.join(", ");
  },
  sqlserver: (r) => {
    const cfg = r.config as SqlServerConfig;
    return `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`;
  },
  kubernetes: (r) => {
    const cfg = r.config as KubernetesConfig;
    // Extract current-context (or the override) from the kubeconfig text without
    // pulling in a YAML parser at module load.
    const ctx =
      cfg.context ||
      cfg.kubeconfig.match(/current-context:\s*([^\n]+)/)?.[1]?.trim() ||
      "kubeconfig";
    return ctx;
  },
  supabase: (r) => {
    const cfg = r.config as SupabaseConfig;
    return cfg.url.replace(/^https?:\/\//, "");
  },
  neo4j: (r) => {
    const cfg = r.config as Neo4jConfig;
    return `${cfg.user}@${cfg.uri}${cfg.database ? `/${cfg.database}` : ""}`;
  },
  qdrant: (r) => {
    const cfg = r.config as QdrantConfig;
    return cfg.url;
  },
  weaviate: (r) => {
    const cfg = r.config as WeaviateConfig;
    return cfg.url;
  },
  milvus: (r) => {
    const cfg = r.config as MilvusConfig;
    return cfg.address;
  },
  chroma: (r) => {
    const cfg = r.config as ChromaConfig;
    return `${cfg.url}${cfg.database ? ` (${cfg.tenant ?? "default"}/${cfg.database})` : ""}`;
  },
};
