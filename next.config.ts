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
  ],
};

export default nextConfig;
