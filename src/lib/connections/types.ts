export type TechId =
  | "docker"
  | "kafka"
  | "postgres"
  | "mysql"
  | "sqlserver"
  | "kubernetes"
  | "redis"
  | "mongo";

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
  /**
   * Optional Confluent-compatible Schema Registry URL (e.g.
   * https://psrc-xxxxx.us-east-2.aws.confluent.cloud). When set, the
   * driver sniffs the Confluent magic byte (0x00 + 4-byte schema id)
   * on consume and decodes Avro / JSON Schema / Protobuf payloads.
   */
  schemaRegistryUrl?: string;
  /** Optional basic-auth for the Schema Registry. */
  schemaRegistryAuth?: {
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

export interface MysqlConfig {
  host: string;
  port: number;
  /** Default database to open the workspace on. Empty = server-level. */
  database: string;
  user: string;
  password: string;
  /** Enable TLS to the server. */
  ssl: boolean;
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

export interface RedisConfig {
  /**
   * `"single"` connects to one host:port. `"cluster"` takes a list of seed
   * nodes and lets ioredis discover the rest of the cluster topology via
   * CLUSTER SLOTS.
   */
  mode: "single" | "cluster";
  /** Single-node host (mode === "single"). */
  host?: string;
  /** Single-node port (mode === "single"). */
  port?: number;
  /** Cluster seed nodes "host:port,host:port,…" (mode === "cluster"). */
  nodes?: string;
  /** ACL username (Redis 6+). Empty = default user. */
  username?: string;
  /** Password / ACL secret. Stored as a secret field. */
  password?: string;
  /** Logical DB index (single mode only; cluster ignores DB selection). */
  db?: number;
  /** Enable TLS to the server (`rediss://`). */
  tls: boolean;
}

export interface MongoConfig {
  /**
   * Full MongoDB connection string — `mongodb://` for self-hosted,
   * `mongodb+srv://` for Atlas / SRV records. Treated as a secret because
   * the URI contains the password.
   */
  uri: string;
  /** Default database to open the workspace on. Empty = list all. */
  defaultDb?: string;
}

export interface KubernetesConfig {
  /**
   * Where the kubeconfig lives. `"path"` reads a file from disk (default
   * ~/.kube/config); `"inline"` stores the YAML directly in the connection
   * record. Inline YAML is treated as a secret by the persistence layer.
   */
  source: "path" | "inline";
  /** Absolute or ~-prefixed path to a kubeconfig file. */
  kubeconfigPath?: string;
  /** Pasted kubeconfig YAML. */
  kubeconfigYaml?: string;
  /** Context name inside the kubeconfig. Empty = current-context. */
  context?: string;
  /** Default namespace to pin in the workspace. Empty = "default". */
  namespace?: string;
}
