import { createConnection } from "node:net";

/**
 * Quick TCP reachability probe. Resolves true if a connection opens
 * within `timeoutMs`, false otherwise. Used by integration tests to
 * gate themselves with `describe.skipIf` when a service isn't running.
 */
export function isReachable(
  host: string,
  port: number,
  timeoutMs = 800,
): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("error", () => finish(false));
    sock.once("timeout", () => finish(false));
  });
}

/**
 * Cached reachability lookups so test files don't re-probe the same
 * host:port pair multiple times in one run.
 */
const cache = new Map<string, Promise<boolean>>();
export function reachable(host: string, port: number): Promise<boolean> {
  const key = `${host}:${port}`;
  let p = cache.get(key);
  if (!p) {
    p = isReachable(host, port);
    cache.set(key, p);
  }
  return p;
}
