import type { NextConfig } from "next";
import { SERVER_EXTERNAL_PACKAGES } from "./src/techs/server-packages.generated";

const nextConfig: NextConfig = {
  serverExternalPackages: [...SERVER_EXTERNAL_PACKAGES],
};

export default nextConfig;
