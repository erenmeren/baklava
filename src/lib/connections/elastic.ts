import { Client } from "@elastic/elasticsearch";
import type { ElasticConfig } from "./types";

function buildAuth(config: ElasticConfig) {
  if (config.apiKey) return { apiKey: config.apiKey };
  if (config.user)
    return { username: config.user, password: config.password ?? "" };
  return undefined;
}

export function createElasticClient(config: ElasticConfig): Client {
  return new Client({
    node: config.nodes,
    auth: buildAuth(config),
    requestTimeout: 5000,
  });
}

async function withClient<T>(
  config: ElasticConfig,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = createElasticClient(config);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ElasticProbeResult {
  name: string;
  clusterName: string;
  version: string;
}

export async function probeElastic(
  config: ElasticConfig
): Promise<ElasticProbeResult> {
  const client = createElasticClient(config);
  try {
    const info = (await client.info()) as unknown as {
      name?: string;
      cluster_name?: string;
      version?: { number?: string };
    };
    return {
      name: info.name ?? "",
      clusterName: info.cluster_name ?? "",
      version: info.version?.number ?? "",
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ElasticTopIndex {
  name: string;
  docCount: number;
  storeSize: number;
}

export interface ElasticOverview {
  version: string;
  clusterName: string;
  nodeName: string;
  status: "green" | "yellow" | "red" | "unknown";
  nodeCount: number;
  totalIndices: number;
  totalDocs: number;
  totalStoreBytes: number;
  jvmHeapUsedBytes: number;
  jvmHeapMaxBytes: number;
  topIndicesByDocs: ElasticTopIndex[];
}

export async function getOverview(
  config: ElasticConfig
): Promise<ElasticOverview> {
  const client = createElasticClient(config);
  try {
    const info = (await client.info()) as unknown as {
      name?: string;
      cluster_name?: string;
      version?: { number?: string };
    };
    const health = (await client.cluster.health()) as unknown as {
      status?: string;
      number_of_nodes?: number;
    };
    const stats = (await client.cluster.stats()) as unknown as {
      indices?: {
        count?: number;
        docs?: { count?: number };
        store?: { size_in_bytes?: number };
      };
      nodes?: {
        count?: { total?: number };
        jvm?: {
          mem?: {
            heap_used_in_bytes?: number;
            heap_max_in_bytes?: number;
          };
        };
      };
    };
    // Top-5 indices by docs.count via cat.indices
    const cat = (await client.cat.indices({
      format: "json",
      bytes: "b",
      h: "index,docs.count,store.size",
    })) as unknown as {
      index?: string;
      "docs.count"?: string;
      "store.size"?: string;
    }[];
    const indices: ElasticTopIndex[] = (Array.isArray(cat) ? cat : []).map(
      (row) => ({
        name: row.index ?? "",
        docCount: Number(row["docs.count"] ?? 0) || 0,
        storeSize: Number(row["store.size"] ?? 0) || 0,
      })
    );
    const topIndicesByDocs = [...indices]
      .sort((a, b) => b.docCount - a.docCount)
      .slice(0, 5);

    const rawStatus = (health.status ?? "").toLowerCase();
    const status: ElasticOverview["status"] =
      rawStatus === "green" || rawStatus === "yellow" || rawStatus === "red"
        ? rawStatus
        : "unknown";

    return {
      version: info.version?.number ?? "",
      clusterName: info.cluster_name ?? "",
      nodeName: info.name ?? "",
      status,
      nodeCount:
        stats.nodes?.count?.total ?? health.number_of_nodes ?? 0,
      totalIndices: stats.indices?.count ?? indices.length,
      totalDocs: stats.indices?.docs?.count ?? 0,
      totalStoreBytes: stats.indices?.store?.size_in_bytes ?? 0,
      jvmHeapUsedBytes: stats.nodes?.jvm?.mem?.heap_used_in_bytes ?? 0,
      jvmHeapMaxBytes: stats.nodes?.jvm?.mem?.heap_max_in_bytes ?? 0,
      topIndicesByDocs,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ElasticIndexSummary {
  name: string;
  health: "green" | "yellow" | "red" | "unknown";
  docCount: number;
  storeSize: number;
  primaries: number;
  replicas: number;
  system: boolean;
}

export async function listIndices(
  config: ElasticConfig
): Promise<ElasticIndexSummary[]> {
  const client = createElasticClient(config);
  try {
    const rows = (await client.cat.indices({
      format: "json",
      bytes: "b",
      h: "index,health,docs.count,store.size,pri,rep",
    })) as unknown as {
      index?: string;
      health?: string;
      "docs.count"?: string;
      "store.size"?: string;
      pri?: string;
      rep?: string;
    }[];

    const list: ElasticIndexSummary[] = (Array.isArray(rows) ? rows : []).map(
      (r) => {
        const name = r.index ?? "";
        const h = (r.health ?? "").toLowerCase();
        const health: ElasticIndexSummary["health"] =
          h === "green" || h === "yellow" || h === "red" ? h : "unknown";
        return {
          name,
          health,
          docCount: Number(r["docs.count"] ?? 0) || 0,
          storeSize: Number(r["store.size"] ?? 0) || 0,
          primaries: Number(r.pri ?? 0) || 0,
          replicas: Number(r.rep ?? 0) || 0,
          system: name.startsWith("."),
        };
      }
    );
    return list.sort((a, b) => b.docCount - a.docCount);
  } finally {
    await client.close().catch(() => undefined);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Index detail
// ─────────────────────────────────────────────────────────────────────────────

export interface ElasticShardRow {
  shard: string;
  prirep: "p" | "r" | string;
  state: string;
  docs: number;
  store: number;
  node: string;
}

export interface ElasticIndexDetailHeader {
  name: string;
  health: "green" | "yellow" | "red" | "unknown";
  docs: number;
  deletedDocs: number;
  sizeBytes: number;
  primarySizeBytes: number;
  primaries: number;
  replicas: number;
  refreshInterval: string;
  system: boolean;
  aliases: string[];
}

export interface ElasticIndexDetail {
  index: ElasticIndexDetailHeader;
  mappings: Record<string, unknown>;
  settings: Record<string, unknown>;
  shards: ElasticShardRow[];
}

export async function getElasticIndex(
  config: ElasticConfig,
  name: string
): Promise<ElasticIndexDetail> {
  return withClient(config, async (client) => {
    const getRes = (await client.indices.get({
      index: name,
      features: ["aliases", "mappings", "settings"],
      flat_settings: false,
      include_defaults: false,
    })) as unknown as Record<
      string,
      {
        aliases?: Record<string, unknown>;
        mappings?: Record<string, unknown>;
        settings?: { index?: Record<string, unknown> } & Record<
          string,
          unknown
        >;
      }
    >;

    const key = Object.keys(getRes)[0] ?? name;
    const entry = getRes[key] ?? {};
    const aliases = Object.keys(entry.aliases ?? {});
    const mappings = (entry.mappings ?? {}) as Record<string, unknown>;
    const settings = (entry.settings ?? {}) as Record<string, unknown>;
    const indexSettings = (settings.index ?? {}) as Record<string, unknown>;
    const primaries =
      Number(
        (indexSettings.number_of_shards as string | number | undefined) ?? 0
      ) || 0;
    const replicas =
      Number(
        (indexSettings.number_of_replicas as string | number | undefined) ?? 0
      ) || 0;
    const refreshInterval =
      String(
        (indexSettings.refresh_interval as string | undefined) ?? "1s"
      ) || "1s";

    const statsRes = (await client.indices.stats({
      index: name,
    })) as unknown as {
      indices?: Record<
        string,
        {
          primaries?: {
            docs?: { count?: number; deleted?: number };
            store?: { size_in_bytes?: number };
          };
          total?: {
            docs?: { count?: number; deleted?: number };
            store?: { size_in_bytes?: number };
          };
        }
      >;
    };
    const idxStats = statsRes.indices?.[key] ?? statsRes.indices?.[name] ?? {};
    const docs = idxStats.primaries?.docs?.count ?? 0;
    const deletedDocs = idxStats.primaries?.docs?.deleted ?? 0;
    const sizeBytes = idxStats.total?.store?.size_in_bytes ?? 0;
    const primarySizeBytes = idxStats.primaries?.store?.size_in_bytes ?? 0;

    const shardRows = (await client.cat.shards({
      index: name,
      format: "json",
      bytes: "b",
      h: "shard,prirep,state,docs,store,node",
    })) as unknown as {
      shard?: string;
      prirep?: string;
      state?: string;
      docs?: string;
      store?: string;
      node?: string;
    }[];
    const shards: ElasticShardRow[] = (Array.isArray(shardRows) ? shardRows : [])
      .map((r) => ({
        shard: r.shard ?? "",
        prirep: (r.prirep ?? "") as ElasticShardRow["prirep"],
        state: r.state ?? "",
        docs: Number(r.docs ?? 0) || 0,
        store: Number(r.store ?? 0) || 0,
        node: r.node ?? "",
      }))
      .sort((a, b) => {
        if (a.shard !== b.shard) return a.shard.localeCompare(b.shard);
        return a.prirep.localeCompare(b.prirep);
      });

    // Health derivation: green if all shards STARTED, yellow if any unassigned
    // replica, red if any unassigned primary. We trust shards rather than
    // cluster.health which is cluster-wide.
    let health: ElasticIndexDetailHeader["health"] = "green";
    for (const s of shards) {
      if (s.state !== "STARTED") {
        if (s.prirep === "p") {
          health = "red";
          break;
        }
        health = "yellow";
      }
    }
    if (shards.length === 0) health = "unknown";

    return {
      index: {
        name: key,
        health,
        docs,
        deletedDocs,
        sizeBytes,
        primarySizeBytes,
        primaries,
        replicas,
        refreshInterval,
        system: key.startsWith("."),
        aliases,
      },
      mappings,
      settings,
      shards,
    };
  });
}

export async function deleteElasticIndex(
  config: ElasticConfig,
  name: string
): Promise<void> {
  await withClient(config, async (client) => {
    await client.indices.delete({ index: name });
  });
}

export interface ElasticHit {
  _id: string;
  _score: number | null;
  _source: unknown;
}

export interface ElasticSearchResult {
  total: number;
  hits: ElasticHit[];
}

export async function searchElasticIndex(
  config: ElasticConfig,
  name: string,
  query: string,
  size: number
): Promise<ElasticSearchResult> {
  return withClient(config, async (client) => {
    const trimmed = (query ?? "").trim();
    const safeSize = Math.max(1, Math.min(100, Math.floor(size) || 10));
    const res = (await client.search({
      index: name,
      size: safeSize,
      _source: true,
      ...(trimmed
        ? { q: trimmed }
        : { query: { match_all: {} } }),
    })) as unknown as {
      hits?: {
        total?: number | { value?: number };
        hits?: {
          _id?: string;
          _score?: number | null;
          _source?: unknown;
        }[];
      };
    };
    const totalRaw = res.hits?.total;
    const total =
      typeof totalRaw === "number"
        ? totalRaw
        : typeof totalRaw === "object" && totalRaw
          ? Number(totalRaw.value ?? 0) || 0
          : 0;
    const hits: ElasticHit[] = (res.hits?.hits ?? []).map((h) => ({
      _id: String(h._id ?? ""),
      _score: h._score ?? null,
      _source: h._source,
    }));
    return { total, hits };
  });
}
