import { ChromaClient, type Collection } from "chromadb";
import type { ChromaConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Client factory
//
// Chroma talks plain HTTP, so there's no socket to close — each request opens
// a new connection through the underlying fetch implementation. No finally
// teardown needed.
// ─────────────────────────────────────────────────────────────────────────────

function parseUrl(url: string): {
  host: string;
  port: number | undefined;
  ssl: boolean;
} {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : undefined,
      ssl: u.protocol === "https:",
    };
  } catch {
    return { host: url, port: undefined, ssl: false };
  }
}

function createChromaClient(config: ChromaConfig): ChromaClient {
  const { host, port, ssl } = parseUrl(config.url);
  const headers: Record<string, string> = {};
  if (config.authToken) {
    headers["X-Chroma-Token"] = config.authToken;
    headers.Authorization = `Bearer ${config.authToken}`;
  }
  return new ChromaClient({
    host,
    port,
    ssl,
    tenant: config.tenant || "default_tenant",
    database: config.database || "default_database",
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe
// ─────────────────────────────────────────────────────────────────────────────

export interface ChromaProbeResult {
  version: string;
  heartbeatNs: number;
  collectionCount: number;
}

export async function probeChroma(
  config: ChromaConfig
): Promise<ChromaProbeResult> {
  const client = createChromaClient(config);
  const [heartbeatNs, version, collections] = await Promise.all([
    client.heartbeat(),
    client.version().catch(() => "unknown"),
    client.listCollections({ limit: 1000 }).catch(() => [] as Collection[]),
  ]);
  return {
    version,
    heartbeatNs,
    collectionCount: collections.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection summary
// ─────────────────────────────────────────────────────────────────────────────

export interface ChromaCollectionStat {
  name: string;
  id: string;
  count: number;
  metadataKeys: string[];
  configHint: string;
}

function configurationHint(coll: Collection): string {
  const cfg = coll.configuration as unknown as Record<string, unknown>;
  if (!cfg) return "";
  const hnsw =
    (cfg.hnsw as Record<string, unknown> | undefined) ||
    (cfg.hnsw_configuration as Record<string, unknown> | undefined);
  if (hnsw) {
    const space = hnsw.space ?? hnsw.distance_function;
    if (space) return `HNSW · ${String(space)}`;
    return "HNSW";
  }
  const spann = cfg.spann as Record<string, unknown> | undefined;
  if (spann) return "SPANN";
  return "";
}

export interface ChromaSummary {
  url: string;
  tenant: string;
  database: string;
  version: string;
  heartbeatNs: number;
  heartbeatOk: boolean;
  collectionCount: number;
  totalDocuments: number;
  topCollections: { name: string; count: number }[];
  collections: ChromaCollectionStat[];
}

export async function getChromaSummary(
  config: ChromaConfig
): Promise<ChromaSummary> {
  const client = createChromaClient(config);
  const tenant = config.tenant || "default_tenant";
  const database = config.database || "default_database";

  let heartbeatNs = 0;
  let heartbeatOk = false;
  try {
    heartbeatNs = await client.heartbeat();
    heartbeatOk = true;
  } catch {
    heartbeatOk = false;
  }
  const version = await client.version().catch(() => "unknown");
  const collections = await client.listCollections({ limit: 1000 });

  const stats = await Promise.all(
    collections.map(async (coll) => {
      const count = await coll.count().catch(() => 0);
      const metadataKeys = coll.metadata
        ? Object.keys(coll.metadata as Record<string, unknown>)
        : [];
      return {
        name: coll.name,
        id: coll.id,
        count,
        metadataKeys,
        configHint: configurationHint(coll),
      } satisfies ChromaCollectionStat;
    })
  );

  const totalDocuments = stats.reduce((s, c) => s + c.count, 0);
  const topCollections = [...stats]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((c) => ({ name: c.name, count: c.count }));

  return {
    url: config.url,
    tenant,
    database,
    version,
    heartbeatNs,
    heartbeatOk,
    collectionCount: stats.length,
    totalDocuments,
    topCollections,
    collections: stats.sort((a, b) => b.count - a.count),
  };
}

export async function listChromaCollections(
  config: ChromaConfig
): Promise<ChromaCollectionStat[]> {
  const summary = await getChromaSummary(config);
  return summary.collections;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection detail
// ─────────────────────────────────────────────────────────────────────────────

export interface ChromaCollectionDetail {
  name: string;
  id: string;
  count: number;
  metadata: Record<string, unknown>;
  configuration: Record<string, unknown>;
  /** Inferred from peek() — metadata keys that appeared across sample. */
  metadataFields: { name: string; type: string }[];
  distanceFunction: string;
  embeddingFunctionName: string;
  hnswParams: Record<string, unknown> | null;
}

function inferTypes(
  rows: Array<Record<string, unknown> | null | undefined>
): { name: string; type: string }[] {
  const types = new Map<string, string>();
  for (const row of rows) {
    if (!row) continue;
    for (const [k, v] of Object.entries(row)) {
      if (types.has(k)) continue;
      if (v == null) types.set(k, "null");
      else if (Array.isArray(v)) types.set(k, "array");
      else types.set(k, typeof v);
    }
  }
  return [...types.entries()]
    .map(([name, type]) => ({ name, type }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function describeChromaCollection(
  config: ChromaConfig,
  name: string
): Promise<ChromaCollectionDetail> {
  const client = createChromaClient(config);
  const coll = await client.getCollection({ name });
  const count = await coll.count().catch(() => 0);

  // Peek a small slice purely to infer metadata field types
  const sample = await coll.peek({ limit: 10 }).catch(() => undefined);
  const metadataFields = inferTypes(
    (sample?.metadatas as Array<Record<string, unknown> | null> | undefined) ??
      []
  );

  const cfg = (coll.configuration as Record<string, unknown>) ?? {};
  const hnsw =
    (cfg.hnsw as Record<string, unknown> | undefined) ||
    (cfg.hnsw_configuration as Record<string, unknown> | undefined) ||
    null;
  const distanceFunction =
    (hnsw?.space as string | undefined) ||
    (hnsw?.distance_function as string | undefined) ||
    (cfg.distance_function as string | undefined) ||
    "—";

  const ef = cfg.embedding_function as Record<string, unknown> | undefined;
  const embeddingFunctionName =
    (ef?.name as string | undefined) ||
    (ef?.type as string | undefined) ||
    coll.embeddingFunction?.name ||
    "default";

  return {
    name: coll.name,
    id: coll.id,
    count,
    metadata: (coll.metadata as Record<string, unknown>) ?? {},
    configuration: cfg,
    metadataFields,
    distanceFunction,
    embeddingFunctionName,
    hnswParams: hnsw,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample documents
// ─────────────────────────────────────────────────────────────────────────────

export interface ChromaSampleItem {
  id: string;
  document: string | null;
  metadata: Record<string, unknown> | null;
  /** Vector dimension count (vectors themselves not sent to client). */
  embeddingDim: number | null;
}

export interface ChromaSampleResult {
  items: ChromaSampleItem[];
  note?: string;
}

export async function sampleChromaCollection(
  config: ChromaConfig,
  name: string,
  limit: number
): Promise<ChromaSampleResult> {
  const cappedLimit = Math.max(1, Math.min(100, limit));
  const client = createChromaClient(config);
  const coll = await client.getCollection({ name });
  const peek = await coll.peek({ limit: cappedLimit });

  const ids = peek.ids ?? [];
  const docs = peek.documents ?? [];
  const metas = peek.metadatas ?? [];
  const embeds = (peek.embeddings ?? []) as number[][] | null[];

  const items: ChromaSampleItem[] = ids.map((id, i) => {
    const emb = embeds?.[i];
    return {
      id: String(id),
      document: (docs?.[i] as string | null | undefined) ?? null,
      metadata:
        (metas?.[i] as Record<string, unknown> | null | undefined) ?? null,
      embeddingDim: Array.isArray(emb) ? emb.length : null,
    };
  });

  return {
    items,
    note: items.length === 0 ? "Collection is empty." : undefined,
  };
}

/** Drawer-only fetch: includes the FULL vector for one id (first/last 10 dims). */
export interface ChromaSampleDetail extends ChromaSampleItem {
  embeddingHead: number[];
  embeddingTail: number[];
}

export async function getChromaSampleDetail(
  config: ChromaConfig,
  name: string,
  id: string
): Promise<ChromaSampleDetail | null> {
  const client = createChromaClient(config);
  const coll = await client.getCollection({ name });
  const res = await coll.get({
    ids: [id],
    include: ["documents", "metadatas", "embeddings"] as never,
  });
  const ids = res.ids ?? [];
  if (ids.length === 0) return null;
  const emb = (res.embeddings as number[][] | null | undefined)?.[0];
  const head = Array.isArray(emb) ? emb.slice(0, 10) : [];
  const tail =
    Array.isArray(emb) && emb.length > 20 ? emb.slice(emb.length - 10) : [];
  return {
    id: String(ids[0]),
    document: (res.documents as (string | null)[] | undefined)?.[0] ?? null,
    metadata:
      (res.metadatas as (Record<string, unknown> | null)[] | undefined)?.[0] ??
      null,
    embeddingDim: Array.isArray(emb) ? emb.length : null,
    embeddingHead: head,
    embeddingTail: tail,
  };
}
