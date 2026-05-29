import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "dockerode",
    "ssh2",
    "kafkajs",
    "avsc",
    "pg",
    "mysql2",
    "mssql",
    "tedious",
    "@kubernetes/client-node",
    "ioredis",
    "mongodb",
  ],
};

export default nextConfig;
