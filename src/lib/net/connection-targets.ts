import "server-only";
import dns from "node:dns/promises";
import { assertHostAllowed, EgressBlockedError } from "./egress";
import { formatError } from "@/lib/errors";
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

/**
 * Parse with the driver's own loader (js-yaml under client-node), so merge
 * keys / anchors resolve exactly as they will at connect time. Throws when the
 * driver couldn't load it either.
 */
async function kubeServers(yaml: string): Promise<string[]> {
  const { KubeConfig } = await import("@kubernetes/client-node");
  const kc = new KubeConfig();
  kc.loadFromString(yaml);
  return kc.clusters.flatMap((c) => [hostOf(c.server), c.proxyUrl ? hostOf(c.proxyUrl) : null]).filter(
    (h): h is string => !!h,
  );
}

/** Every host a connection config would make the server connect to. Throws on an unloadable kubeconfig. */
export async function targetHostsOf(tech: TechId, config: unknown): Promise<string[]> {
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
      if (c.source === "inline") hosts.push(...(await kubeServers(str(c.kubeconfigYaml))));
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
 * is refused: it can't be judged, and fails closed.
 */
export async function egressRejection(tech: TechId, config: unknown): Promise<Response | null> {
  const reject = (error: string) => Response.json({ ok: false, error }, { status: 400 });
  let hosts: string[];
  try {
    hosts = await targetHostsOf(tech, config);
  } catch (err) {
    return reject(`Invalid kubeconfig: ${formatError(err)}`);
  }
  const c = (config ?? {}) as Record<string, unknown>;
  // A mongodb+srv name is an SRV record (often with no A record); the driver
  // connects to the SRV targets, so those are what gets judged.
  const srv = tech === "mongo" && typeof c.uri === "string" && /^mongodb\+srv:/i.test(c.uri);
  for (const host of hosts) {
    let names: string[];
    try {
      names = srv ? (await dns.resolveSrv(`_mongodb._tcp.${host}`)).map((r) => r.name) : [host];
    } catch {
      return reject(`Could not resolve ${host}`);
    }
    for (const name of names) {
      try {
        await assertHostAllowed(name);
      } catch (err) {
        if (err instanceof EgressBlockedError && err.category !== "unresolved") return reject(err.message);
        return reject(`Could not resolve ${name}`);
      }
    }
  }
  return null;
}
