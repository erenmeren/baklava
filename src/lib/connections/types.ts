export type TechId =
  | "docker"
  | "kafka"
  | "postgres"
  | "mysql"
  | "sqlserver"
  | "kubernetes"
  | "redis"
  | "mongo"
  | "r2"
  | "minio"
  | "s3"
  | "qdrant";

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
  /**
   * User id of the connection's owner (RBAC). Optional for backwards
   * compatibility — legacy rows written before ownership existed have no
   * owner and are treated as admin-only by `listConnectionsForUser`.
   */
  ownerId?: string;
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

export interface R2Config {
  /**
   * Cloudflare account ID. The S3 endpoint is derived as
   * `https://<accountId>.r2.cloudflarestorage.com`; region is always "auto".
   */
  accountId: string;
  /** R2 access key ID. Not a secret — treated like a username. */
  accessKeyId: string;
  /** R2 secret access key. Stored as a secret (see SECRET_KEYS). */
  secretAccessKey: string;
  /** Optional default bucket to open the workspace on. Empty = list all. */
  bucket?: string;
}

export interface MinioConfig {
  /** "host:port" or a full "http(s)://host:port" URL. */
  endpoint: string;
  /** Used only when `endpoint` has no scheme. */
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  /** S3 region; default "us-east-1". */
  region: string;
  bucket?: string;
}

export interface S3Config {
  /** AWS region, e.g. "us-east-1". Drives the endpoint. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Optional temporary-credential session token. */
  sessionToken?: string;
  bucket?: string;
}

export interface QdrantConfig {
  /** Base URL, e.g. http://localhost:6333 or a Qdrant Cloud URL. */
  url: string;
  /** Optional API key (Qdrant Cloud). Stored as a secret. */
  apiKey?: string;
}
