/** @type {import('next').NextConfig} */
const nextConfig = {
  // Mark native modules as external so the bundler doesn't try to crawl their
  // platform-specific binaries.
  serverExternalPackages: ["duckdb", "better-sqlite3", "pg"],

  // Bind to localhost only in production (the CLI also passes -H 127.0.0.1).
  // No remote-image domains; baklava is local-first.
  images: { remotePatterns: [] },
};

export default nextConfig;
