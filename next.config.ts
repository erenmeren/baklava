import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "dockerode",
    "ssh2",
    "kafkajs",
    "pg",
    "ioredis",
    "mysql2",
    "mongodb",
    "amqplib",
    "@elastic/elasticsearch",
    "@clickhouse/client",
    "nats",
    "better-sqlite3",
    "etcd3",
    "mssql",
    "tedious",
    "@kubernetes/client-node",
    "@supabase/supabase-js",
    "neo4j-driver",
    "@qdrant/js-client-rest",
    "weaviate-client",
    "@zilliz/milvus2-sdk-node",
    "chromadb",
  ],
};

export default nextConfig;
