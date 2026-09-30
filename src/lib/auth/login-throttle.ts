/**
 * Best-effort in-memory brute-force throttle for /api/auth/login. Resets on
 * restart and is per-process.
 *
 * Two buckets, and a request is refused when either is full:
 *
 * - **Per account** (the username, or the sole-user login) — always on. This is
 *   what bounds guesses against one password; it can't be dodged by changing
 *   headers.
 * - **Per client address** — only when `BAKLAVA_TRUST_PROXY=1`, i.e. when a
 *   reverse proxy we trust sets `X-Forwarded-For`. Otherwise that header is
 *   whatever the client typed (rotating it gave unlimited guesses), and with no
 *   proxy every request fell into one shared bucket, so ten bad attempts locked
 *   *everyone* out. Route handlers don't see the socket address in this Next
 *   version, so without a trusted proxy there is no client bucket at all.
 */

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_PER_ACCOUNT = 10;
export const MAX_PER_CLIENT = 30;
/** Above this many tracked keys, expired ones are swept on the next failure. */
const SWEEP_AT = 1000;

interface Bucket {
  count: number;
  first: number;
}

const globalKey = Symbol.for("baklava.loginThrottle");
function buckets(): Map<string, Bucket> {
  const g = globalThis as unknown as Record<symbol, Map<string, Bucket>>;
  return (g[globalKey] ??= new Map());
}

function keysFor(account: string, headers: Headers): { key: string; max: number }[] {
  const keys = [{ key: `acct:${account.trim().toLowerCase()}`, max: MAX_PER_ACCOUNT }];
  if (process.env.BAKLAVA_TRUST_PROXY === "1") {
    const ip = headers.get("x-forwarded-for")?.split(",")[0].trim();
    if (ip) keys.push({ key: `ip:${ip}`, max: MAX_PER_CLIENT });
  }
  return keys;
}

function live(key: string, now: number): Bucket | undefined {
  const b = buckets().get(key);
  if (b && now - b.first > WINDOW_MS) {
    buckets().delete(key);
    return undefined;
  }
  return b;
}

export function isLoginThrottled(account: string, headers: Headers, now = Date.now()): boolean {
  return keysFor(account, headers).some(({ key, max }) => (live(key, now)?.count ?? 0) >= max);
}

export function recordLoginFailure(account: string, headers: Headers, now = Date.now()): void {
  const map = buckets();
  if (map.size > SWEEP_AT) {
    for (const [k, b] of map) if (now - b.first > WINDOW_MS) map.delete(k);
  }
  for (const { key } of keysFor(account, headers)) {
    const b = live(key, now);
    if (b) b.count += 1;
    else map.set(key, { count: 1, first: now });
  }
}

/** A successful login clears the account's bucket (not the client's). */
export function clearLoginFailures(account: string): void {
  buckets().delete(`acct:${account.trim().toLowerCase()}`);
}

export function _resetLoginThrottleForTests(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[globalKey];
}
