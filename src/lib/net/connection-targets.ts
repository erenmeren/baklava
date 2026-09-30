import "server-only";
import YAML from "yaml";
import { assertHostAllowed, EgressBlockedError } from "./egress";
import type { TechId } from "@/lib/connections/types";

/** Host part of "host:port", "[v6]:port" or a URL; null when there is none. */
function hostOf(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
    try {
      return new URL(v).hostname.replace(/^\[|\]$/g, "") || null;
    } catch {
      return null;
    }
  }
  const v6 = v.match(/^\[([^\]]+)\]/);
  if (v6) return v6[1];
  return v.split(":")[0] || null;
}

/** Mongo URIs can list several hosts: mongodb://u:p@h1:1,h2:2/db?… */
function mongoHosts(uri: string): string[] {
  const m = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/i);
  return m ? m[1].split(",").map(hostOf).filter((h): h is string => !!h) : [];
}

function kubeServers(yaml: string): string[] {
  try {
    const doc = YAML.parse(yaml) as { clusters?: Array<{ cluster?: { server?: unknown } }> } | null;
    return (doc?.clusters ?? [])
      .map((c) => (typeof c?.cluster?.server === "string" ? hostOf(c.cluster.server) : null))
      .filter((h): h is string => !!h);
  } catch {
    return [];
  }
}

/** Every host a connection config would make the server connect to. */
export function targetHostsOf(tech: TechId, config: unknown): string[] {
  const c = (config ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const hosts: (string | null)[] = [];
  if (str(c.host)) hosts.push(hostOf(str(c.host)));
  switch (tech) {
    case "redis":
      for (const n of str(c.nodes).split(/[,\s]+/)) hosts.push(hostOf(n));
      break;
    case "kafka":
      if (Array.isArray(c.brokers)) for (const b of c.brokers) hosts.push(hostOf(String(b)));
      hosts.push(hostOf(str(c.schemaRegistryUrl)));
      break;
    case "mongo":
      hosts.push(...mongoHosts(str(c.uri)));
      break;
    case "qdrant":
      hosts.push(hostOf(str(c.url)));
      break;
    case "minio":
      hosts.push(hostOf(str(c.endpoint)));
      break;
    case "kubernetes":
      if (c.source === "inline") hosts.push(...kubeServers(str(c.kubeconfigYaml)));
      break;
  }
  return [...new Set(hosts.filter((h): h is string => !!h))];
}

/**
 * Refuse connection targets in the always-blocked ranges (cloud metadata,
 * link-local) — the same egress policy the load test and health probe use.
 * Probing a connection makes the server open a socket to whatever the form
 * says and echo the error back, which made every `/test` route an SSRF and
 * port-scan oracle. Private and loopback targets stay allowed: reaching the
 * databases on your own network is the product. A name that doesn't resolve
 * is left for the driver to report.
 */
export async function egressRejection(tech: TechId, config: unknown): Promise<Response | null> {
  for (const host of targetHostsOf(tech, config)) {
    try {
      await assertHostAllowed(host);
    } catch (err) {
      if (err instanceof EgressBlockedError && err.category !== "unresolved") {
        return Response.json({ ok: false, error: err.message }, { status: 400 });
      }
      // DNS failure / unresolved: not our call to make.
    }
  }
  return null;
}
