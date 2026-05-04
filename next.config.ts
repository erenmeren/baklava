import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["dockerode", "ssh2", "kafkajs", "pg"],
};

export default nextConfig;
