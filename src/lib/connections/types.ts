export type TechId =
  | "docker"
  | "kafka"
  | "postgres"
  | "redis"
  | "mysql"
  | "mongo"
  | "rabbit"
  | "elastic"
  | "clickhouse"
  | "nats"
  | "sqlite"
  | "etcd"
  | "sqlserver";

export type ConnectionStatus = "untested" | "ok" | "error";

export interface ConnectionRecord<C = unknown> {
  id: string;
  tech: TechId;
  name: string;
  config: C;
  status: ConnectionStatus;
  lastError?: string;
  createdAt: number;
  lastTestedAt?: number;
}

export interface DockerConfig {
  mode: "socket" | "tcp";
  socketPath?: string;
  host?: string;
  port?: number;
  protocol?: "http" | "https";
}

export interface KafkaConfig {
  clientId: string;
  brokers: string[];
  ssl: boolean;
  sasl?: {
    mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
    username: string;
    password: string;
  };
}

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  tls: boolean;
  database: number;
}

export interface MysqlConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface MongoConfig {
  /** Connection string. Alternative to host/port fields. */
  uri?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  authSource?: string;
  tls?: boolean;
}

export interface RabbitConfig {
  host: string;
  port: number;
  vhost: string;
  user: string;
  password: string;
  tls: boolean;
  /** Management API port (default 15672) for queue listings. */
  managementPort?: number;
}

export interface ElasticConfig {
  /** Single node URL or comma-separated list. e.g. http://localhost:9200 */
  nodes: string[];
  user?: string;
  password?: string;
  apiKey?: string;
}

export interface ClickhouseConfig {
  /** HTTP interface URL, e.g. http://localhost:8123 */
  url: string;
  user: string;
  password: string;
  database: string;
}

export interface NatsConfig {
  /** One or more nats://host:port servers */
  servers: string[];
  user?: string;
  password?: string;
  token?: string;
}

export interface SqliteConfig {
  /** Absolute path to the .sqlite/.db file on the server. */
  filePath: string;
  readonly: boolean;
}

export interface EtcdConfig {
  hosts: string[];
  user?: string;
  password?: string;
}

export interface SqlServerConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** Enable TLS to the server. */
  encrypt: boolean;
  /** Trust self-signed/unknown certs (dev / private networks). */
  trustServerCertificate: boolean;
}
