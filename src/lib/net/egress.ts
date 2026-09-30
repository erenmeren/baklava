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

const METADATA_V4 = new Set(["100.100.100.200", "192.0.0.192"]);

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
  // IPv6 transition prefixes carry an IPv4 address inside them, and a NAT64 /
  // 6to4 gateway will happily deliver to it — judge the embedded address.
  if (addr.kind() === "ipv6") {
    const p = (addr as ipaddr.IPv6).parts;
    const embedded =
      p[0] === 0x64 && p[1] === 0xff9b && p[2] === 0 && p[3] === 0 && p[4] === 0 && p[5] === 0
        ? [p[6] >> 8, p[6] & 0xff, p[7] >> 8, p[7] & 0xff] // 64:ff9b::/96 (NAT64)
        : p[0] === 0x2002
          ? [p[1] >> 8, p[1] & 0xff, p[2] >> 8, p[2] & 0xff] // 2002::/16 (6to4)
          : null;
    if (embedded) addr = new ipaddr.IPv4(embedded);
  }
  // Cloud instance-metadata services that live outside link-local: Alibaba
  // (100.100.100.200, inside the CGNAT range) and Oracle (192.0.0.192).
  if (addr.kind() === "ipv4" && METADATA_V4.has(addr.toString())) return "metadata";
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

/**
 * The always-blocked categories as CIDRs, for enforcers that match ranges
 * themselves (k6's `blacklistIPs`). Kept beside classifyIp so the two agree.
 */
export const ALWAYS_BLOCKED_CIDRS: readonly string[] = [
  "169.254.0.0/16", // link-local, incl. 169.254.169.254
  "fe80::/10", // IPv6 link-local
  "fd00:ec2::254/128", // AWS IMDS over IPv6
  "100.100.100.200/32", // Alibaba metadata
  "192.0.0.192/32", // Oracle metadata
];

/** ALWAYS_BLOCKED_CIDRS minus any range containing a BAKLAVA_EGRESS_ALLOW IP. */
export function blockedCidrsHonouringAllowList(): { cidrs: string[]; carvedOut: boolean } {
  const allowed = allowList().filter((ip) => ipaddr.isValid(ip)).map((ip) => ipaddr.parse(ip));
  const cidrs = ALWAYS_BLOCKED_CIDRS.filter((cidr) => {
    const range = ipaddr.parseCIDR(cidr);
    return !allowed.some((a) => a.kind() === range[0].kind() && a.match(range));
  });
  return { cidrs, carvedOut: cidrs.length !== ALWAYS_BLOCKED_CIDRS.length };
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
