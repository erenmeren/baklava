import Redis from "ioredis";
import type { RedisConfig } from "./types";

function createClient(config: RedisConfig): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password || undefined,
    tls: config.tls ? {} : undefined,
    db: config.database ?? 0,
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
}

async function withClient<T>(
  config: RedisConfig,
  fn: (client: Redis) => Promise<T>
): Promise<T> {
  const client = createClient(config);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    client.disconnect();
  }
}

export interface RedisProbeResult {
  version: string;
  role: string;
}

export async function probeRedis(config: RedisConfig): Promise<RedisProbeResult> {
  return withClient(config, async (client) => {
    await client.ping();
    const info = await client.info("server");
    const replInfo = await client.info("replication");
    const parsed = parseInfo(info);
    const repl = parseInfo(replInfo);
    return {
      version: parsed["redis_version"] ?? "unknown",
      role: repl["role"] ?? "unknown",
    };
  });
}

export interface RedisKeyspaceEntry {
  db: number;
  keys: number;
  expires: number;
  avgTtl: number;
}

export interface RedisOverview {
  version: string;
  mode: string;
  os: string;
  role: string;
  uptimeSeconds: number;
  connectedClients: number;
  blockedClients: number;
  usedMemory: number;
  usedMemoryHuman: string;
  maxMemory: number;
  maxMemoryHuman: string;
  totalCommandsProcessed: number;
  instantaneousOpsPerSec: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRatio: number | null;
  totalKeys: number;
  keyspace: RedisKeyspaceEntry[];
  replication: {
    role: string;
    connectedReplicas: number;
    masterHost?: string;
    masterPort?: number;
    masterLinkStatus?: string;
  };
}

function parseInfo(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function parseKeyspaceLine(value: string): {
  keys: number;
  expires: number;
  avgTtl: number;
} {
  // e.g. "keys=5,expires=2,avg_ttl=0"
  const parts: Record<string, string> = {};
  for (const seg of value.split(",")) {
    const [k, v] = seg.split("=");
    if (k && v != null) parts[k.trim()] = v.trim();
  }
  return {
    keys: Number(parts.keys ?? 0) || 0,
    expires: Number(parts.expires ?? 0) || 0,
    avgTtl: Number(parts.avg_ttl ?? 0) || 0,
  };
}

export async function getRedisOverview(
  config: RedisConfig
): Promise<RedisOverview> {
  return withClient(config, async (client) => {
    const [serverInfo, clientsInfo, memoryInfo, statsInfo, replicationInfo, keyspaceInfo] =
      await Promise.all([
        client.info("server"),
        client.info("clients"),
        client.info("memory"),
        client.info("stats"),
        client.info("replication"),
        client.info("keyspace"),
      ]);

    const s = parseInfo(serverInfo);
    const c = parseInfo(clientsInfo);
    const m = parseInfo(memoryInfo);
    const st = parseInfo(statsInfo);
    const r = parseInfo(replicationInfo);
    const k = parseInfo(keyspaceInfo);

    const keyspace: RedisKeyspaceEntry[] = [];
    let totalKeys = 0;
    for (const [name, value] of Object.entries(k)) {
      const match = name.match(/^db(\d+)$/);
      if (!match) continue;
      const parsed = parseKeyspaceLine(value);
      keyspace.push({ db: Number(match[1]), ...parsed });
      totalKeys += parsed.keys;
    }
    keyspace.sort((a, b) => a.db - b.db);

    const hits = Number(st["keyspace_hits"] ?? 0);
    const misses = Number(st["keyspace_misses"] ?? 0);
    const hitRatio = hits + misses > 0 ? hits / (hits + misses) : null;

    return {
      version: s["redis_version"] ?? "unknown",
      mode: s["redis_mode"] ?? "standalone",
      os: s["os"] ?? "",
      role: r["role"] ?? "unknown",
      uptimeSeconds: Number(s["uptime_in_seconds"] ?? 0) || 0,
      connectedClients: Number(c["connected_clients"] ?? 0) || 0,
      blockedClients: Number(c["blocked_clients"] ?? 0) || 0,
      usedMemory: Number(m["used_memory"] ?? 0) || 0,
      usedMemoryHuman: m["used_memory_human"] ?? "0B",
      maxMemory: Number(m["maxmemory"] ?? 0) || 0,
      maxMemoryHuman: m["maxmemory_human"] ?? "0B",
      totalCommandsProcessed: Number(st["total_commands_processed"] ?? 0) || 0,
      instantaneousOpsPerSec:
        Number(st["instantaneous_ops_per_sec"] ?? 0) || 0,
      keyspaceHits: hits,
      keyspaceMisses: misses,
      hitRatio,
      totalKeys,
      keyspace,
      replication: {
        role: r["role"] ?? "unknown",
        connectedReplicas: Number(r["connected_slaves"] ?? 0) || 0,
        masterHost: r["master_host"],
        masterPort: r["master_port"] ? Number(r["master_port"]) : undefined,
        masterLinkStatus: r["master_link_status"],
      },
    };
  });
}

export interface RedisKeyEntry {
  key: string;
  type: string;
  ttl: number;
  memoryBytes: number | null;
}

export interface RedisKeyListResult {
  keys: RedisKeyEntry[];
  nextCursor: string;
  scanned: number;
}

export interface ListKeysOptions {
  pattern?: string;
  cursor?: string;
  count?: number;
}

/**
 * Paginated key listing via SCAN. Never uses KEYS — that blocks the server.
 *
 * SCAN returns batches of keys whose size depends on COUNT (a hint, not a
 * guarantee). We do per-key TYPE/TTL/MEMORY USAGE pipelined so a single
 * page costs one round trip plus one bulk pipeline.
 */
export async function listRedisKeys(
  config: RedisConfig,
  opts: ListKeysOptions = {}
): Promise<RedisKeyListResult> {
  const pattern = opts.pattern && opts.pattern.length > 0 ? opts.pattern : "*";
  const cursor = opts.cursor ?? "0";
  const count = Math.max(10, Math.min(1000, opts.count ?? 100));

  return withClient(config, async (client) => {
    const [nextCursor, rawKeys] = await client.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      count
    );

    if (rawKeys.length === 0) {
      return { keys: [], nextCursor, scanned: 0 };
    }

    const pipeline = client.pipeline();
    for (const k of rawKeys) {
      pipeline.type(k);
      pipeline.ttl(k);
      pipeline.memory("USAGE", k);
    }
    const results = await pipeline.exec();

    const entries: RedisKeyEntry[] = [];
    for (let i = 0; i < rawKeys.length; i++) {
      const typeRes = results?.[i * 3];
      const ttlRes = results?.[i * 3 + 1];
      const memRes = results?.[i * 3 + 2];
      const type =
        typeRes && !typeRes[0] && typeof typeRes[1] === "string"
          ? (typeRes[1] as string)
          : "unknown";
      const ttl =
        ttlRes && !ttlRes[0] && typeof ttlRes[1] === "number"
          ? (ttlRes[1] as number)
          : -2;
      const memoryBytes =
        memRes && !memRes[0] && typeof memRes[1] === "number"
          ? (memRes[1] as number)
          : null;
      entries.push({ key: rawKeys[i], type, ttl, memoryBytes });
    }

    return { keys: entries, nextCursor, scanned: rawKeys.length };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-key detail
// ──────────────────────────────────────────────────────────────────────────────

export type RedisKeyType =
  | "string"
  | "list"
  | "hash"
  | "set"
  | "zset"
  | "stream"
  | "none";

export interface RedisZsetEntry {
  member: string;
  score: number;
}

export interface RedisStreamEntry {
  id: string;
  fields: Record<string, string>;
}

export type RedisKeyValue =
  | string
  | string[]
  | Record<string, string>
  | RedisZsetEntry[]
  | RedisStreamEntry[]
  | null;

export interface RedisKeyDetail {
  key: string;
  type: RedisKeyType;
  ttl: number;
  memoryBytes: number | null;
  value: RedisKeyValue;
  truncated: boolean;
}

/**
 * Display caps. List/set/zset use 500; streams a tighter 100 since each entry
 * is itself a small object.
 */
const COLLECTION_CAP = 500;
const STREAM_CAP = 100;

/**
 * Fetch a single key's type-aware value plus TTL + memory usage.
 *
 * Caps every variable-length collection so a 10M-entry list can't OOM the
 * server. `truncated` is true when the on-server count exceeds the cap.
 */
export async function getRedisKey(
  config: RedisConfig,
  key: string
): Promise<RedisKeyDetail> {
  return withClient(config, async (client) => {
    const type = (await client.type(key)) as RedisKeyType;
    if (type === "none") {
      throw new Error("Key not found");
    }
    const [ttl, memoryBytes] = await Promise.all([
      client.ttl(key),
      client
        .memory("USAGE", key)
        .then((n) => (typeof n === "number" ? n : null))
        .catch(() => null),
    ]);

    let value: RedisKeyValue = null;
    let truncated = false;

    switch (type) {
      case "string": {
        value = (await client.get(key)) ?? "";
        break;
      }
      case "list": {
        const len = await client.llen(key);
        const items = await client.lrange(key, 0, COLLECTION_CAP - 1);
        value = items;
        truncated = len > COLLECTION_CAP;
        break;
      }
      case "hash": {
        value = await client.hgetall(key);
        break;
      }
      case "set": {
        const card = await client.scard(key);
        if (card <= COLLECTION_CAP) {
          value = await client.smembers(key);
        } else {
          // SSCAN with COUNT so the server doesn't ship megabytes for the
          // truncation preview. Loop until we hit the cap or scan completes.
          const out: string[] = [];
          let cursor = "0";
          do {
            const [next, batch] = await client.sscan(
              key,
              cursor,
              "COUNT",
              Math.min(200, COLLECTION_CAP - out.length)
            );
            out.push(...batch);
            cursor = next;
          } while (cursor !== "0" && out.length < COLLECTION_CAP);
          value = out.slice(0, COLLECTION_CAP);
          truncated = true;
        }
        break;
      }
      case "zset": {
        const total = await client.zcard(key);
        // ZRANGE … WITHSCORES returns [member, score, member, score, …].
        const raw = await client.zrange(
          key,
          0,
          COLLECTION_CAP - 1,
          "WITHSCORES"
        );
        const entries: RedisZsetEntry[] = [];
        for (let i = 0; i + 1 < raw.length; i += 2) {
          entries.push({ member: raw[i], score: Number(raw[i + 1]) });
        }
        value = entries;
        truncated = total > COLLECTION_CAP;
        break;
      }
      case "stream": {
        const total = await client.xlen(key);
        // XRANGE returns [[id, [f1, v1, f2, v2, …]], …]
        const raw = (await client.xrange(
          key,
          "-",
          "+",
          "COUNT",
          STREAM_CAP
        )) as Array<[string, string[]]>;
        const entries: RedisStreamEntry[] = raw.map(([id, kvs]) => {
          const fields: Record<string, string> = {};
          for (let i = 0; i + 1 < kvs.length; i += 2) {
            fields[kvs[i]] = kvs[i + 1];
          }
          return { id, fields };
        });
        value = entries;
        truncated = total > STREAM_CAP;
        break;
      }
      default:
        // unknown type (older modules etc) — return nothing rather than crash.
        value = null;
    }

    return { key, type, ttl, memoryBytes, value, truncated };
  });
}

export async function deleteRedisKey(
  config: RedisConfig,
  key: string
): Promise<void> {
  await withClient(config, async (client) => {
    await client.del(key);
  });
}
