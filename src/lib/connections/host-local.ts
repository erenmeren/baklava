import "server-only";
import YAML from "yaml";
import type { TechId } from "./types";

/**
 * Some connection configs don't point at a remote service — they reach into the
 * machine Baklava itself runs on, with Baklava's own privileges:
 *
 * - Docker in socket mode talks to the host's daemon (root on the host).
 * - A kubeconfig *path* reads the operator's own kubeconfig from disk.
 * - An inline kubeconfig can name an `exec` / `auth-provider` credential plugin,
 *   which the client library spawns as a process, or `*-file` / `token-file`
 *   fields, which make it read arbitrary host files (e.g. the master key) and
 *   send them to the cluster `server` of the author's choosing.
 *
 * Creating a connection makes the creator its owner (⇒ `write`), so letting a
 * member save one of these hands them the host. Only admins may.
 */

/** Config keys that choose *where* a connection points (vs. its credentials). */
const LOCATION_KEYS: Partial<Record<TechId, readonly string[]>> = {
  docker: ["mode", "socketPath"],
  kubernetes: ["source", "kubeconfigPath", "kubeconfigYaml"],
};

/** Kubeconfig keys that execute a program or read a file on the host. The
 *  `*-data` variants carry the value inline and are fine. */
const HOST_REACHING_KUBECONFIG_KEYS = new Set([
  "exec",
  "auth-provider",
  "token-file",
  "tokenFile",
  "certificate-authority",
  "client-certificate",
  "client-key",
]);

function findHostReachingKey(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findHostReachingKey(item);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (HOST_REACHING_KUBECONFIG_KEYS.has(key)) return key;
      const hit = findHostReachingKey(value);
      if (hit) return hit;
    }
  }
  return null;
}

/** Why this config reaches the Baklava host, or null if it doesn't. */
export function hostLocalReason(tech: TechId, config: unknown): string | null {
  const c = (config ?? {}) as Record<string, unknown>;
  if (tech === "docker") {
    return c.mode === "tcp" ? null : "uses the Baklava host's Docker socket";
  }
  if (tech === "kubernetes") {
    if (c.source !== "inline") return "reads a kubeconfig file on the Baklava host";
    const yaml = typeof c.kubeconfigYaml === "string" ? c.kubeconfigYaml : "";
    let doc: unknown;
    try {
      doc = YAML.parse(yaml);
    } catch {
      // The client library might still accept what we can't parse — fail closed.
      return "has a kubeconfig that could not be checked";
    }
    const key = findHostReachingKey(doc);
    return key ? `has a kubeconfig \`${key}\` entry that runs or reads on the Baklava host` : null;
  }
  return null;
}

/** True when any of the patched (set or unset) keys changes where a connection points. */
export function touchesLocation(tech: TechId, keys: readonly string[]): boolean {
  const location = LOCATION_KEYS[tech] ?? [];
  return keys.some((k) => location.includes(k));
}

/** Error body for a non-admin trying to save a host-local config. */
export function hostLocalForbidden(reason: string): Response {
  return Response.json(
    { ok: false, error: `Only an admin can save a connection that ${reason}.` },
    { status: 403 },
  );
}
