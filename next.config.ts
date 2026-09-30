import type { NextConfig } from "next";
import { SERVER_EXTERNAL_PACKAGES } from "./src/techs/server-packages.generated";

// Non-tech server externals: native/asset-bearing packages used outside the
// tech registry. pdfkit reads its own font-metric files at runtime, so it must
// not be bundled by Turbopack.
const EXTRA_SERVER_PACKAGES = ["pdfkit", "@napi-rs/keyring"];

// An ops console holding database credentials: never framed (clickjacking the
// destructive confirm dialogs), never MIME-sniffed, never leaking its URLs —
// which carry connection ids — to other origins. A full script CSP is left out
// deliberately: Next's inline bootstrap scripts need per-request nonces, which
// would force every page dynamic. HSTS belongs on the TLS-terminating proxy.
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: [...SERVER_EXTERNAL_PACKAGES, ...EXTRA_SERVER_PACKAGES],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
