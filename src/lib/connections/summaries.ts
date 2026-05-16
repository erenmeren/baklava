import type {
  ClickhouseConfig,
  ConnectionRecord,
  DockerConfig,
  ElasticConfig,
  EtcdConfig,
  KafkaConfig,
  MongoConfig,
  MysqlConfig,
  NatsConfig,
  PostgresConfig,
  RabbitConfig,
  RedisConfig,
  SqliteConfig,
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
};
