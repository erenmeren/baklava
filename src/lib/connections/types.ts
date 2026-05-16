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
  | "sqlserver"
  | "kubernetes"
  | "supabase"
  | "neo4j"
  | "qdrant"
  | "weaviate"
  | "milvus"
  | "chroma";

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

export interface KubernetesConfig {
  /** Full kubeconfig YAML text. Lets users plug in kind / minikube / EKS / GKE / AKS without us caring how the auth works. */
  kubeconfig: string;
  /** Optional context name within the kubeconfig. Falls back to current-context. */
  context?: string;
}

export interface SupabaseConfig {
  /** e.g. https://abcdefgh.supabase.co */
  url: string;
  /** service_role key (JWT) — admin level, never anon. Used for management APIs. */
  serviceRoleKey: string;
  /** Optional Postgres connection string for the SQL passthrough. */
  databaseUrl?: string;
}

export interface Neo4jConfig {
  /** bolt://host:7687  •  neo4j+s://host  •  bolt+s://host */
  uri: string;
  user: string;
  password: string;
  /** Optional default database (Neo4j 4.x+ supports multi-db). */
  database?: string;
}

export interface QdrantConfig {
  /** REST URL, e.g. http://localhost:6333 */
  url: string;
  /** Optional API key (Qdrant Cloud / secured deployments). */
  apiKey?: string;
}

export interface WeaviateConfig {
  /** REST scheme+host+port, e.g. http://localhost:8080 */
  url: string;
  /** Optional API key. */
  apiKey?: string;
}

export interface MilvusConfig {
  /** host:port — gRPC address. */
  address: string;
  /** Optional auth token (username:password or Zilliz Cloud token). */
  token?: string;
  ssl: boolean;
}

export interface ChromaConfig {
  /** REST URL, e.g. http://localhost:8000 */
  url: string;
  tenant?: string;
  database?: string;
  /** Optional auth token for Chroma Cloud. */
  authToken?: string;
}
