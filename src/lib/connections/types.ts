export type TechId = "docker" | "kafka" | "postgres" | "sqlserver";

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
