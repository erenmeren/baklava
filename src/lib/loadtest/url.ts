const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/**
 * Ensure a base URL has an http(s) scheme. Users naturally type "localhost:3000"
 * or "api.example.com"; without a scheme `new URL()` mis-parses (e.g.
 * `new URL("localhost:200")` reads "localhost:" as the PROTOCOL), and k6 then
 * rejects it with `unsupported protocol scheme "localhost"`. Default to http://.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * k6 runs inside a Docker container, so `localhost` would resolve to the
 * container itself, not the host. Rewrite local hostnames to the Docker
 * host gateway alias so a host-run target API is reachable. Also normalizes a
 * missing scheme first so schemeless inputs are handled correctly.
 */
export function rewriteLocalhostForDocker(baseUrl: string): {
  url: string;
  rewritten: boolean;
} {
  const normalized = normalizeBaseUrl(baseUrl);
  const u = new URL(normalized);
  if (LOCAL_HOSTS.has(u.hostname)) {
    u.hostname = "host.docker.internal";
    return { url: u.toString(), rewritten: true };
  }
  return { url: normalized, rewritten: false };
}
