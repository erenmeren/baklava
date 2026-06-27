import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import ipaddr from "ipaddr.js";

export type IpCategory = "metadata" | "link-local" | "loopback" | "private" | "public";

export class EgressBlockedError extends Error {
  constructor(
    public host: string,
    public ip: string,
    public category: string,
  ) {
    super(`Egress to ${host}${ip ? ` (${ip})` : ""} blocked: ${category}`);
    this.name = "EgressBlockedError";
  }
}

export function classifyIp(ip: string): IpCategory {
  let addr;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    // Inputs come pre-validated (net.isIP literals or DNS results); an
    // unparseable value here is unexpected. Treat as public (the caller only
    // ever blocks the known-bad categories).
    return "public";
  }
  // Unwrap IPv4-mapped IPv6 (::ffff:a.b.c.d in any spelling) to the embedded v4
  // so a mapped metadata/loopback address can't masquerade as public.
  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) addr = v6.toIPv4Address();
  }
  // AWS instance-metadata addresses are specific IPs inside broader ranges
  // (169.254.169.254 ∈ link-local; fd00:ec2::254 ∈ unique-local) — name them
  // explicitly. Both are always blocked regardless of category.
  if (addr.kind() === "ipv4" && addr.toString() === "169.254.169.254") return "metadata";
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).toNormalizedString() === "fd00:ec2:0:0:0:0:0:254") {
    return "metadata";
  }
  const range = addr.range();
  if (range === "loopback" || range === "unspecified") return "loopback";
  if (range === "linkLocal") return "link-local";
  if (range === "private" || range === "uniqueLocal" || range === "carrierGradeNat") return "private";
  return "public";
}

const ALWAYS_BLOCK: ReadonlySet<IpCategory> = new Set<IpCategory>(["metadata", "link-local"]);

function allowList(): string[] {
  return (process.env.BAKLAVA_EGRESS_ALLOW ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface EgressOptions {
  allowPrivate?: boolean;
  allowLoopback?: boolean;
  lookup?: (host: string) => Promise<string[]>;
}

export async function assertHostAllowed(host: string, opts: EgressOptions = {}): Promise<string[]> {
  const allowPrivate = opts.allowPrivate !== false;
  const allowLoopback = opts.allowLoopback !== false;
  const allowed = allowList();

  const ips = net.isIP(host)
    ? [host]
    : opts.lookup
      ? await opts.lookup(host)
      : (await dns.lookup(host, { all: true })).map((r) => r.address);

  if (ips.length === 0) throw new EgressBlockedError(host, "", "unresolved");

  for (const ip of ips) {
    if (allowed.includes(ip)) continue;
    const cat = classifyIp(ip);
    if (ALWAYS_BLOCK.has(cat)) throw new EgressBlockedError(host, ip, cat);
    if (cat === "private" && !allowPrivate) throw new EgressBlockedError(host, ip, cat);
    if (cat === "loopback" && !allowLoopback) throw new EgressBlockedError(host, ip, cat);
  }
  return ips;
}
