import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFileSync, chmodSync } from "node:fs";
import { instanceKeyPath, baklavaDir } from "./config.js";
import { mkdirSync } from "node:fs";
import { BaklavaException, makeError } from "./errors.js";

/**
 * Per-instance shared secret. Generated on first run, stored chmod 600 in
 * ~/.baklava/instance.key. The browser frontend reads it via a server-rendered
 * meta tag and sends it back as X-Baklava-Token on every API call. Defeats
 * cross-origin POSTs that aren't from baklava's own UI.
 */
export function getOrCreateInstanceToken(): string {
  const path = instanceKeyPath();
  if (existsSync(path)) {
    const token = readFileSync(path, "utf8").trim();
    if (token.length >= 32) return token;
  }
  if (!existsSync(baklavaDir())) {
    mkdirSync(baklavaDir(), { recursive: true, mode: 0o700 });
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return token;
}

export interface SecurityCheckInput {
  /** request.headers.get("origin") — null if not present (e.g., curl, server-side fetch) */
  origin: string | null;
  /** request.headers.get("host") — never null in practice */
  host: string | null;
  /** request.headers.get("x-baklava-token") — must equal the instance token */
  token: string | null;
  /** The expected port baklava is listening on (e.g., 3000). Localhost-only. */
  expectedPort: number;
}

export type SecurityCheckResult =
  | { ok: true }
  | { ok: false; code: "E_CSRF_BAD_HOST" | "E_CSRF_BAD_ORIGIN" | "E_CSRF_MISSING_TOKEN"; reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalHost(host: string): boolean {
  // Strip port if present. IPv6 hosts come bracketed like "[::1]:3000".
  let hostname: string;
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    hostname = close >= 0 ? host.slice(0, close + 1) : host;
  } else {
    const idx = host.lastIndexOf(":");
    hostname = idx >= 0 ? host.slice(0, idx) : host;
  }
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

function originMatches(origin: string, expectedPort: number): boolean {
  // Accept http://localhost:PORT, http://127.0.0.1:PORT, http://[::1]:PORT.
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.port && Number(u.port) !== expectedPort) return false;
    if (!u.port && expectedPort !== 80) return false;
    return LOCAL_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Three-gate CSRF / DNS-rebinding check. ALL must pass.
 *
 *  1. Host header must be a local hostname (defeats DNS rebinding — an
 *     attacker's DNS-rebound name will not be "localhost" or "127.0.0.1").
 *  2. Origin header (if present) must match http://localhost:PORT or
 *     127.0.0.1:PORT. Same-origin checks block cross-origin POSTs.
 *  3. X-Baklava-Token header must equal the per-instance secret.
 *
 * Origin is allowed to be missing for non-browser clients (curl, fetch in a
 * Node script, the `baklava query` CLI). The token alone is sufficient for
 * those, since they're explicitly running with the user's filesystem access.
 */
export function checkRequestSecurity(input: SecurityCheckInput): SecurityCheckResult {
  if (!input.host || !isLocalHost(input.host)) {
    return {
      ok: false,
      code: "E_CSRF_BAD_HOST",
      reason: `Host header "${input.host}" is not localhost. baklava only accepts requests bound to 127.0.0.1.`,
    };
  }
  if (input.origin !== null && !originMatches(input.origin, input.expectedPort)) {
    return {
      ok: false,
      code: "E_CSRF_BAD_ORIGIN",
      reason: `Origin "${input.origin}" does not match http://localhost:${input.expectedPort}.`,
    };
  }
  const expected = getOrCreateInstanceToken();
  if (!input.token || !timingSafeEquals(input.token, expected)) {
    return {
      ok: false,
      code: "E_CSRF_MISSING_TOKEN",
      reason: input.token
        ? "X-Baklava-Token did not match the instance secret."
        : "X-Baklava-Token header is missing.",
    };
  }
  return { ok: true };
}

/**
 * Constant-time string compare. Length mismatch returns false immediately
 * (acceptable since the token is a fixed 64-char hex string).
 */
function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Throw a BaklavaException for a failed security check. */
export function throwIfInsecure(result: SecurityCheckResult): asserts result is { ok: true } {
  if (result.ok) return;
  const fixMap = {
    E_CSRF_BAD_HOST:
      "If you reached this URL via something other than http://localhost:PORT, switch to localhost. baklava is local-first by design.",
    E_CSRF_BAD_ORIGIN:
      "Open baklava in the browser by visiting http://localhost:<port> directly. Cross-origin requests are blocked.",
    E_CSRF_MISSING_TOKEN:
      "The browser frontend includes the token automatically. If you're scripting against the API, read ~/.baklava/instance.key (chmod 600) and send it as X-Baklava-Token.",
  } as const;
  throw new BaklavaException(
    makeError({
      code: result.code,
      what: "Request rejected by the security gate.",
      why: result.reason,
      fix: fixMap[result.code],
    })
  );
}
