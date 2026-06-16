import "server-only";
import { PassThrough } from "node:stream";
import type { Redis, Cluster } from "ioredis"; // type-only — erased at build, safe when ioredis absent
import type { RedisConfig } from "./types";
import { DriverNotInstalledError } from "@/techs/contract";

let _ioredisMod: typeof import("ioredis") | null = null;
async function getIoredis(): Promise<typeof import("ioredis")> {
  try {
    return (_ioredisMod ??= await import("ioredis"));
  } catch {
    throw new DriverNotInstalledError("redis", "ioredis");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Client cache
//
// One persistent client per connection so commands don't pay TCP+auth on every
// request. Keyed by id + structural hash of the config — editing the
// connection invalidates lazily on the next call.
// ─────────────────────────────────────────────────────────────────────────────

type Client = Redis | Cluster;

interface ClientBundle {
  hash: string;
  client: Client;
  isCluster: boolean;
}

const globalKey = Symbol.for("baklava.redisClients");

function getCache(): Map<string, ClientBundle> {
  const g = globalThis as unknown as Record<symbol, Map<string, ClientBundle>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function hashConfig(cfg: RedisConfig): string {
  return JSON.stringify([
    cfg.mode,
    cfg.host ?? "",
    cfg.port ?? 0,
    cfg.nodes ?? "",
    cfg.username ?? "",
    cfg.password ?? "",
    cfg.db ?? 0,
    cfg.tls,
  ]);
}

function parseSeedNodes(spec: string): { host: string; port: number }[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [host, portRaw] = entry.split(":");
      const port = Number(portRaw);
      if (!host || !Number.isFinite(port)) {
        throw new Error(`Bad cluster seed node: "${entry}"`);
      }
      return { host: host.trim(), port };
    });
}

async function buildClient(cfg: RedisConfig): Promise<{ client: Client; isCluster: boolean }> {
  const { default: RedisConstructor, Cluster: ClusterConstructor } = await getIoredis();
  if (cfg.mode === "cluster") {
    const seeds = parseSeedNodes(cfg.nodes ?? "");
    if (seeds.length === 0) {
      throw new Error("Cluster mode requires at least one seed node");
    }
    const client = new ClusterConstructor(seeds, {
      redisOptions: {
        username: cfg.username || undefined,
        password: cfg.password || undefined,
        tls: cfg.tls ? {} : undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 5_000,
      },
      enableReadyCheck: false,
      lazyConnect: true,
    });
    return { client, isCluster: true };
  }
  const client = new RedisConstructor({
    host: cfg.host || "127.0.0.1",
    port: cfg.port ?? 6379,
    username: cfg.username || undefined,
    password: cfg.password || undefined,
    db: cfg.db ?? 0,
    tls: cfg.tls ? {} : undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  return { client, isCluster: false };
}

async function bundleFor(connectionId: string, cfg: RedisConfig): Promise<ClientBundle> {
  const cache = getCache();
  const hash = hashConfig(cfg);
  const cached = cache.get(connectionId);
  if (cached && cached.hash === hash) return cached;
  if (cached) {
    try {
      cached.client.disconnect();
    } catch {
      // ignore
    }
  }
  const { client, isCluster } = await buildClient(cfg);
  // Suppress unhandled error noise — every command handler already inspects
  // promise rejections and surfaces them through formatError.
  client.on("error", () => {});
  const bundle: ClientBundle = { hash, client, isCluster };
  cache.set(connectionId, bundle);
  return bundle;
}

export function dropRedisClient(connectionId: string): void {
  const cache = getCache();
  const cached = cache.get(connectionId);
  if (!cached) return;
  try {
    cached.client.disconnect();
  } catch {
    // ignore
  }
  cache.delete(connectionId);
}

async function ensureConnected(client: Client): Promise<void> {
  if ((client as Redis).status && (client as Redis).status === "ready") return;
  await client.connect().catch((err: Error) => {
    if (err.message?.includes("already connecting")) return;
    if (err.message?.includes("already connected")) return;
    throw err;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types returned to the UI
// ─────────────────────────────────────────────────────────────────────────────

export type RedisType =
  | "string"
  | "hash"
  | "list"
  | "set"
  | "zset"
  | "stream"
  | "ReJSON-RL"
  | "none";

export interface ProbeResult {
  ok: true;
  version: string;
  mode: "standalone" | "cluster" | "sentinel";
  role: string;
  databases: number;
  modules: { name: string; version: string }[];
}

export interface KeyRow {
  key: string;
  type: RedisType;
  ttl: number; // seconds; -1 = no expire, -2 = missing
  size: number; // bytes from MEMORY USAGE (best-effort)
  db?: number;
}

export interface KeysPage {
  keys: KeyRow[];
  scanned: number;
  truncated: boolean;
}

const SCAN_HARD_CAP = 100_000;
const SCAN_PAGE_SIZE = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Probe + INFO
// ─────────────────────────────────────────────────────────────────────────────

function parseInfo(raw: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = "default";
  sections[current] = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) {
      if (line.startsWith("# ")) {
        current = line.slice(2).trim().toLowerCase();
        sections[current] = {};
      }
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    sections[current][line.slice(0, idx)] = line.slice(idx + 1);
  }
  return sections;
}

export async function probe(
  connectionId: string,
  cfg: RedisConfig,
): Promise<ProbeResult> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  // Cluster proxies CLIENT/INFO/etc. across nodes; for probe we just hit the
  // first reachable node.
  const raw = await b.client.info();
  const parsed = parseInfo(raw);
  const server = parsed.server ?? {};
  const replication = parsed.replication ?? {};
  const keyspace = parsed.keyspace ?? {};
  let modules: { name: string; version: string }[] = [];
  try {
    const moduleList = (await (b.client as Redis).call("MODULE", "LIST")) as
      | unknown[]
      | null;
    if (Array.isArray(moduleList)) {
      modules = moduleList
        .map((m) => {
          if (!Array.isArray(m)) return null;
          const obj: Record<string, string> = {};
          for (let i = 0; i < m.length - 1; i += 2) {
            obj[String(m[i])] = String(m[i + 1]);
          }
          return { name: obj.name ?? "?", version: obj.ver ?? "?" };
        })
        .filter((x): x is { name: string; version: string } => x !== null);
    }
  } catch {
    // older redis or restricted ACLs — modules just stays empty
  }
  return {
    ok: true,
    version: server.redis_version ?? "unknown",
    mode:
      (server.redis_mode as ProbeResult["mode"]) ??
      (b.isCluster ? "cluster" : "standalone"),
    role: replication.role ?? "?",
    databases: Object.keys(keyspace).length || 16,
    modules,
  };
}

export async function info(
  connectionId: string,
  cfg: RedisConfig,
  section?: string,
): Promise<Record<string, Record<string, string>>> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  const raw = section
    ? await (b.client as Redis).info(section)
    : await b.client.info();
  return parseInfo(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// Keys
// ─────────────────────────────────────────────────────────────────────────────

export async function listKeys(
  connectionId: string,
  cfg: RedisConfig,
  options: { pattern?: string; db?: number } = {},
): Promise<KeysPage> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  const pattern = options.pattern?.trim() || "*";
  const db = options.db ?? cfg.db ?? 0;
  if (!b.isCluster && db !== (cfg.db ?? 0)) {
    await (b.client as Redis).select(db);
  }
  const seen = new Set<string>();
  let scanned = 0;
  let truncated = false;

  if (b.isCluster) {
    // For cluster we iterate every master node — ioredis exposes them via
    // .nodes("master").
    const masters = (b.client as Cluster).nodes("master");
    outer: for (const node of masters) {
      let cursor = "0";
      do {
        const [next, batch] = await node.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          SCAN_PAGE_SIZE,
        );
        cursor = next;
        scanned += batch.length;
        for (const k of batch) seen.add(k);
        if (seen.size >= SCAN_HARD_CAP) {
          truncated = true;
          break outer;
        }
      } while (cursor !== "0");
    }
  } else {
    let cursor = "0";
    do {
      const [next, batch] = await (b.client as Redis).scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        SCAN_PAGE_SIZE,
      );
      cursor = next;
      scanned += batch.length;
      for (const k of batch) seen.add(k);
      if (seen.size >= SCAN_HARD_CAP) {
        truncated = true;
        break;
      }
    } while (cursor !== "0");
  }

  // Pipeline TYPE + TTL + MEMORY USAGE per key — keeps to one round trip per
  // ~500 keys, fine up to the cap.
  const keys = [...seen];
  const out: KeyRow[] = [];
  const PIPE = 500;
  for (let i = 0; i < keys.length; i += PIPE) {
    const chunk = keys.slice(i, i + PIPE);
    const pipeline = (b.client as Redis).pipeline();
    for (const k of chunk) {
      pipeline.type(k);
      pipeline.ttl(k);
      pipeline.call("MEMORY", "USAGE", k);
    }
    const results = await pipeline.exec();
    if (!results) continue;
    for (let j = 0; j < chunk.length; j++) {
      const typeRes = results[j * 3];
      const ttlRes = results[j * 3 + 1];
      const memRes = results[j * 3 + 2];
      const type =
        ((typeRes?.[1] as string | undefined) ?? "none") as RedisType;
      const ttl = (ttlRes?.[1] as number | undefined) ?? -2;
      const size = (memRes?.[1] as number | undefined) ?? 0;
      out.push({ key: chunk[j], type, ttl, size, db });
    }
  }

  // Stable sort by key so repeat fetches don't shuffle the view.
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { keys: out, scanned, truncated };
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed key reads
// ─────────────────────────────────────────────────────────────────────────────

export interface StringValue {
  kind: "string";
  value: string;
}
export interface HashValue {
  kind: "hash";
  entries: { field: string; value: string }[];
}
export interface ListValue {
  kind: "list";
  items: string[];
  total: number;
}
export interface SetValue {
  kind: "set";
  members: string[];
  total: number;
}
export interface ZSetValue {
  kind: "zset";
  members: { member: string; score: number }[];
  total: number;
}
export interface StreamValue {
  kind: "stream";
  entries: { id: string; fields: { field: string; value: string }[] }[];
  length: number;
}
export interface JsonValue {
  kind: "json";
  value: string;
}
export interface UnknownValue {
  kind: "unknown";
  type: string;
}

export type KeyValue =
  | StringValue
  | HashValue
  | ListValue
  | SetValue
  | ZSetValue
  | StreamValue
  | JsonValue
  | UnknownValue;

export interface KeyDetail {
  key: string;
  type: RedisType;
  ttl: number;
  size: number;
  value: KeyValue;
}

const LIST_PREVIEW = 200;

export async function getKey(
  connectionId: string,
  cfg: RedisConfig,
  rawKey: string,
  db?: number,
): Promise<KeyDetail> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  if (!b.isCluster && typeof db === "number") {
    await (b.client as Redis).select(db);
  }
  const type = ((await b.client.type(rawKey)) as RedisType) ?? "none";
  const [ttl, size] = await Promise.all([
    b.client.ttl(rawKey).catch(() => -1),
    (b.client as Redis).call("MEMORY", "USAGE", rawKey).catch(() => 0) as Promise<number>,
  ]);

  let value: KeyValue;
  switch (type) {
    case "string": {
      const raw = (await b.client.get(rawKey)) ?? "";
      value = { kind: "string", value: raw };
      break;
    }
    case "hash": {
      const obj = (await b.client.hgetall(rawKey)) as Record<string, string>;
      value = {
        kind: "hash",
        entries: Object.entries(obj).map(([field, v]) => ({ field, value: v })),
      };
      break;
    }
    case "list": {
      const total = await b.client.llen(rawKey);
      const items = await b.client.lrange(rawKey, 0, LIST_PREVIEW - 1);
      value = { kind: "list", items, total };
      break;
    }
    case "set": {
      const total = await b.client.scard(rawKey);
      // SRANDMEMBER with count returns up to count distinct members.
      const members = (await b.client.srandmember(
        rawKey,
        LIST_PREVIEW,
      )) as string[];
      value = { kind: "set", members, total };
      break;
    }
    case "zset": {
      const total = await b.client.zcard(rawKey);
      const flat = await b.client.zrange(
        rawKey,
        0,
        LIST_PREVIEW - 1,
        "WITHSCORES",
      );
      const pairs: { member: string; score: number }[] = [];
      for (let i = 0; i < flat.length; i += 2) {
        pairs.push({ member: flat[i], score: Number(flat[i + 1]) });
      }
      value = { kind: "zset", members: pairs, total };
      break;
    }
    case "stream": {
      const length = (await (b.client as Redis).call("XLEN", rawKey)) as number;
      const raw = (await (b.client as Redis).call(
        "XREVRANGE",
        rawKey,
        "+",
        "-",
        "COUNT",
        LIST_PREVIEW,
      )) as [string, string[]][];
      const entries = raw.map(([id, fv]) => {
        const fields: { field: string; value: string }[] = [];
        for (let i = 0; i < fv.length; i += 2) {
          fields.push({ field: fv[i], value: fv[i + 1] });
        }
        return { id, fields };
      });
      value = { kind: "stream", entries, length };
      break;
    }
    case "ReJSON-RL": {
      const raw = (await (b.client as Redis).call(
        "JSON.GET",
        rawKey,
        "$",
      )) as string;
      value = { kind: "json", value: raw };
      break;
    }
    default:
      value = { kind: "unknown", type };
  }
  return { key: rawKey, type, ttl, size, value };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

export async function delKey(
  connectionId: string,
  cfg: RedisConfig,
  key: string,
  db?: number,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  if (!b.isCluster && typeof db === "number") {
    await (b.client as Redis).select(db);
  }
  await b.client.del(key);
}

export async function setTtl(
  connectionId: string,
  cfg: RedisConfig,
  key: string,
  ttlSeconds: number,
  db?: number,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  if (!b.isCluster && typeof db === "number") {
    await (b.client as Redis).select(db);
  }
  if (ttlSeconds < 0) {
    await b.client.persist(key);
  } else {
    await b.client.expire(key, ttlSeconds);
  }
}

export async function setStringValue(
  connectionId: string,
  cfg: RedisConfig,
  key: string,
  value: string,
  db?: number,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  if (!b.isCluster && typeof db === "number") {
    await (b.client as Redis).select(db);
  }
  await b.client.set(key, value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw command (CLI)
// ─────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_AT_CLI = new Set(["MONITOR", "SUBSCRIBE", "PSUBSCRIBE", "WAIT"]);

export async function runCommand(
  connectionId: string,
  cfg: RedisConfig,
  args: string[],
): Promise<unknown> {
  if (args.length === 0) throw new Error("Command is required");
  const head = args[0].toUpperCase();
  if (FORBIDDEN_AT_CLI.has(head)) {
    throw new Error(
      `${head} blocks the connection — use the dedicated panel instead`,
    );
  }
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  return (b.client as Redis).call(head, ...args.slice(1));
}

// ─────────────────────────────────────────────────────────────────────────────
// Clients + slowlog + cluster + ACL
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientInfo {
  id: string;
  addr: string;
  name: string;
  age: number;
  idle: number;
  db: number;
  cmd: string;
  flags: string;
}

export async function listClients(
  connectionId: string,
  cfg: RedisConfig,
): Promise<ClientInfo[]> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  const raw = (await (b.client as Redis).call("CLIENT", "LIST")) as string;
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const fields: Record<string, string> = {};
      for (const part of line.split(" ")) {
        const idx = part.indexOf("=");
        if (idx < 0) continue;
        fields[part.slice(0, idx)] = part.slice(idx + 1);
      }
      return {
        id: fields.id ?? "?",
        addr: fields.addr ?? "?",
        name: fields.name ?? "",
        age: Number(fields.age ?? 0),
        idle: Number(fields.idle ?? 0),
        db: Number(fields.db ?? 0),
        cmd: fields.cmd ?? "",
        flags: fields.flags ?? "",
      };
    });
}

export interface SlowEntry {
  id: number;
  timestamp: number;
  duration: number; // microseconds
  command: string[];
  client?: string;
  clientName?: string;
}

export async function getSlowlog(
  connectionId: string,
  cfg: RedisConfig,
  count = 64,
): Promise<SlowEntry[]> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  const raw = (await (b.client as Redis).call("SLOWLOG", "GET", count)) as unknown[];
  return raw.map((entry) => {
    if (!Array.isArray(entry)) {
      return { id: 0, timestamp: 0, duration: 0, command: [] };
    }
    const [id, ts, dur, cmd, client, clientName] = entry as [
      number,
      number,
      number,
      string[],
      string?,
      string?,
    ];
    return {
      id: Number(id),
      timestamp: Number(ts),
      duration: Number(dur),
      command: Array.isArray(cmd) ? cmd.map(String) : [],
      client: client ?? undefined,
      clientName: clientName ?? undefined,
    };
  });
}

export interface ClusterNode {
  id: string;
  addr: string;
  flags: string;
  role: "master" | "slave" | "replica";
  slotsCovered: number;
}

export async function getClusterNodes(
  connectionId: string,
  cfg: RedisConfig,
): Promise<ClusterNode[]> {
  const b = await bundleFor(connectionId, cfg);
  if (!b.isCluster) return [];
  await ensureConnected(b.client);
  // Use one of the cluster nodes to issue CLUSTER NODES.
  const masters = (b.client as Cluster).nodes();
  const node = masters[0];
  if (!node) return [];
  const raw = (await node.call("CLUSTER", "NODES")) as string;
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(" ");
      const slotsCovered = parts
        .slice(8)
        .filter((p) => p.includes("-") || /^\d+$/.test(p))
        .reduce((sum, range) => {
          if (range.includes("-")) {
            const [lo, hi] = range.split("-").map(Number);
            return sum + (hi - lo + 1);
          }
          return sum + 1;
        }, 0);
      const flags = parts[2] ?? "";
      const role: ClusterNode["role"] = flags.includes("master")
        ? "master"
        : flags.includes("replica") || flags.includes("slave")
          ? "replica"
          : "master";
      return {
        id: parts[0] ?? "?",
        addr: parts[1] ?? "?",
        flags,
        role,
        slotsCovered,
      };
    });
}

export interface AclSummary {
  whoami: string;
  list: string[];
}

export async function getAcl(
  connectionId: string,
  cfg: RedisConfig,
): Promise<AclSummary> {
  const b = await bundleFor(connectionId, cfg);
  await ensureConnected(b.client);
  const whoami = ((await (b.client as Redis)
    .call("ACL", "WHOAMI")
    .catch(() => "default")) as string) ?? "default";
  const list = (await (b.client as Redis)
    .call("ACL", "LIST")
    .catch(() => [] as unknown[])) as unknown[];
  return {
    whoami,
    list: Array.isArray(list) ? list.map(String) : [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pub/Sub
// ─────────────────────────────────────────────────────────────────────────────

export interface PubSubStream {
  output: PassThrough;
  close: () => void;
}

export function subscribePubSub(
  cfg: RedisConfig,
  options: { channels?: string[]; patterns?: string[] },
): PubSubStream {
  // Pub/sub is connection-blocking on ioredis, so we open a *dedicated*
  // client (NOT the cached one) and tear it down with the stream.
  const output = new PassThrough({ objectMode: false });
  const channels = options.channels ?? [];
  const patterns = options.patterns ?? [];
  // clientRef is set inside the IIFE once the module is loaded; close() uses it.
  let clientRef: Client | null = null;
  (async () => {
    try {
      const { client } = await buildClient(cfg);
      clientRef = client;
      client.on("error", (err: Error) => {
        output.write(
          JSON.stringify({ kind: "error", message: err.message }) + "\n",
        );
      });
      client.on("message", (channel: string, message: string) => {
        output.write(
          JSON.stringify({ kind: "message", channel, message }) + "\n",
        );
      });
      client.on(
        "pmessage",
        (pattern: string, channel: string, message: string) => {
          output.write(
            JSON.stringify({ kind: "pmessage", pattern, channel, message }) + "\n",
          );
        },
      );
      await client.connect().catch((err: Error) => {
        if (!err.message?.includes("already")) throw err;
      });
      if (channels.length > 0) {
        await (client as Redis).subscribe(...channels);
      }
      if (patterns.length > 0) {
        await (client as Redis).psubscribe(...patterns);
      }
    } catch (err) {
      output.write(
        JSON.stringify({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        }) + "\n",
      );
    }
  })();
  return {
    output,
    close: () => {
      try {
        clientRef?.disconnect();
      } catch {
        // ignore
      }
      try {
        output.end();
      } catch {
        // ignore
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MONITOR
// ─────────────────────────────────────────────────────────────────────────────

export interface MonitorStream {
  output: PassThrough;
  close: () => void;
}

export async function startMonitor(cfg: RedisConfig): Promise<MonitorStream> {
  const { client } = await buildClient(cfg);
  const output = new PassThrough({ objectMode: false });
  client.on("error", (err: Error) => {
    output.write(
      JSON.stringify({ kind: "error", message: err.message }) + "\n",
    );
  });
  await client.connect().catch((err: Error) => {
    if (!err.message?.includes("already")) throw err;
  });
  // ioredis returns a monitor instance that emits "monitor" events.
  const monitor = await (client as Redis).monitor();
  monitor.on("monitor", (time: string, args: string[], source: string, db: string) => {
    output.write(
      JSON.stringify({ kind: "monitor", time, args, source, db }) + "\n",
    );
  });
  return {
    output,
    close: () => {
      try {
        (monitor as unknown as { disconnect?: () => void }).disconnect?.();
      } catch {
        // ignore
      }
      try {
        client.disconnect();
      } catch {
        // ignore
      }
      try {
        output.end();
      } catch {
        // ignore
      }
    },
  };
}
