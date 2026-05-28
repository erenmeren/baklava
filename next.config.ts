import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "dockerode",
    "ssh2",
    "kafkajs",
    "avsc",
    "pg",
    "mssql",
    "tedious",
    "@kubernetes/client-node",
    "ioredis",
  ],
};

export default nextConfig;
