import type { NextConfig } from "next";
import { SERVER_EXTERNAL_PACKAGES } from "./src/techs/server-packages.generated";

// Non-tech server externals: native/asset-bearing packages used outside the
// tech registry. pdfkit reads its own font-metric files at runtime, so it must
// not be bundled by Turbopack.
const EXTRA_SERVER_PACKAGES = ["pdfkit", "@napi-rs/keyring"];

const nextConfig: NextConfig = {
  serverExternalPackages: [...SERVER_EXTERNAL_PACKAGES, ...EXTRA_SERVER_PACKAGES],
};

export default nextConfig;
