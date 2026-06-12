const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

/**
 * k6 runs inside a Docker container, so `localhost` would resolve to the
 * container itself, not the host. Rewrite local hostnames to the Docker
 * host gateway alias so a host-run target API is reachable.
 */
export function rewriteLocalhostForDocker(baseUrl: string): {
  url: string;
  rewritten: boolean;
} {
  const u = new URL(baseUrl);
  if (LOCAL_HOSTS.has(u.hostname)) {
    u.hostname = "host.docker.internal";
    return { url: u.toString(), rewritten: true };
  }
  return { url: baseUrl, rewritten: false };
}
