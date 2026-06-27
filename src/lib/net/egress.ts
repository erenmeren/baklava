import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

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
  if (net.isIPv4(ip)) {
    if (ip === "169.254.169.254") return "metadata";
    const o = ip.split(".").map(Number);
    if (o[0] === 127 || o[0] === 0) return "loopback";
    if (o[0] === 169 && o[1] === 254) return "link-local";
    if (o[0] === 10) return "private";
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return "private";
    if (o[0] === 192 && o[1] === 168) return "private";
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return "private";
    return "public";
  }
  const a = ip.toLowerCase();
  if (a === "::1") return "loopback";
  if (a === "fd00:ec2::254") return "metadata";
  if (a.startsWith("::ffff:")) return classifyIp(a.slice("::ffff:".length));
  if (/^fe[89ab]/.test(a)) return "link-local";
  if (a.startsWith("fc") || a.startsWith("fd")) return "private";
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
