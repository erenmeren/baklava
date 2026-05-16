import weaviate, { type WeaviateClient } from "weaviate-client";
import type { WeaviateConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Client factory
//
// Weaviate v3 client always speaks BOTH HTTP/1.1 (REST + GraphQL) AND HTTP/2
// (gRPC) under the hood. Self-hosted Weaviate exposes gRPC on port 50051 by
// default, alongside the REST server on 8080. We mirror that convention here:
// the user only provides a single URL, and we infer:
//   - REST: host + port from URL
//   - gRPC: same host, port 50051 (cannot be inferred from REST URL)
//
// If a deployment doesn't expose gRPC, helpers that exercise the gRPC path
// (query.fetchObjects, aggregate.overAll) will throw with a clear message; the
// REST-only helpers (collections.listAll, getMeta) still work.
//
// Every helper opens a fresh client, does its work, then calls `client.close()`
// in `finally` — the gRPC channel keeps live socket pools and leaks if not
// closed explicitly.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_GRPC_PORT = 50051;

export async function createWeaviateClient(
  config: WeaviateConfig
): Promise<WeaviateClient> {
  const parsed = new URL(config.url);
  const secure = parsed.protocol === "https:";
  const httpPort = Number(parsed.port) || (secure ? 443 : 80);
  // gRPC port can't be derived from the URL — Weaviate hosts it on a separate
  // socket. 50051 is the project default for both docker-compose and the
  // helm chart. If you front Weaviate with a proxy that doesn't expose gRPC,
  // pass that detail by editing the connection (future enhancement).
  const grpcPort = DEFAULT_GRPC_PORT;
  return weaviate.connectToCustom({
    httpHost: parsed.hostname,
    httpPort,
    httpSecure: secure,
    grpcHost: parsed.hostname,
    grpcPort,
    grpcSecure: secure,
    authCredentials: config.apiKey
      ? new weaviate.ApiKey(config.apiKey)
      : undefined,
    // Skip the v3 client's startup banner / handshake — saves ~500ms per
    // helper call and lets REST-only deployments work even if the gRPC
    // health check would otherwise refuse the connect.
    skipInitChecks: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shapes (transport types — kept narrow on purpose, the full Weaviate config
// shape changes between minor versions and we just pass it through as raw
// JSON for the "Schema" tab).
// ─────────────────────────────────────────────────────────────────────────────

export interface WeaviatePropertySummary {
  name: string;
  dataType: string;
  description?: string;
  tokenization?: string;
}

export interface WeaviateCollectionSummary {
  name: string;
  description?: string;
  /** -1 means object count is unavailable (e.g. gRPC unreachable). */
  objectCount: number;
  vectorizer: string;
  propertyCount: number;
}

export interface WeaviateProbeResult {
  collectionCount: number;
  version?: string;
}

export interface WeaviateOverview {
  url: string;
  version?: string;
  hostname?: string;
  moduleCount: number;
  modules: string[];
  collectionCount: number;
  totalObjects: number;
  /** True if at least one collection's count failed to resolve (gRPC down etc). */
  partial: boolean;
  collections: WeaviateCollectionSummary[];
  topCollectionsByObjects: { name: string; objects: number }[];
}

export interface WeaviateObjectSummary {
  uuid: string;
  properties: Record<string, unknown>;
  vectorDimensions?: number;
  vectors?: Record<string, unknown>;
  creationTime?: string | null;
  lastUpdateTime?: string | null;
}

export interface WeaviateCollectionDetail {
  name: string;
  description?: string;
  vectorizer: string;
  properties: WeaviatePropertySummary[];
  /** Full raw collection config for the Schema tab DetailBlock. */
  raw: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractVectorizer(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "none";
  const vectorizers = (raw as { vectorizers?: Record<string, unknown> })
    .vectorizers;
  if (!vectorizers || typeof vectorizers !== "object") return "none";
  const names: string[] = [];
  for (const cfg of Object.values(vectorizers)) {
    if (cfg && typeof cfg === "object") {
      const v = (cfg as { vectorizer?: { name?: string } }).vectorizer;
      if (v?.name) names.push(v.name);
    }
  }
  if (names.length === 0) return "none";
  // Deduplicate but preserve order.
  return [...new Set(names)].join(", ");
}

function summarizeProperties(raw: unknown): WeaviatePropertySummary[] {
  if (!raw || typeof raw !== "object") return [];
  const props = (
    raw as { properties?: Array<Record<string, unknown>> }
  ).properties;
  if (!Array.isArray(props)) return [];
  return props.map((p) => ({
    name: String(p.name ?? ""),
    dataType: Array.isArray(p.dataType)
      ? p.dataType.join(", ")
      : String(p.dataType ?? "unknown"),
    description:
      typeof p.description === "string" ? p.description : undefined,
    tokenization:
      typeof p.tokenization === "string" ? p.tokenization : undefined,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe / overview / list / detail / sample
// ─────────────────────────────────────────────────────────────────────────────

export async function probeWeaviate(
  config: WeaviateConfig
): Promise<WeaviateProbeResult> {
  const client = await createWeaviateClient(config);
  try {
    // getMeta is a REST call — works even when gRPC is unreachable.
    const meta = await client.getMeta();
    const collections = await client.collections.listAll();
    return {
      collectionCount: collections.length,
      version: meta?.version,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function listCollections(
  config: WeaviateConfig
): Promise<WeaviateCollectionSummary[]> {
  const client = await createWeaviateClient(config);
  try {
    const collections = await client.collections.listAll();
    // aggregate.overAll uses gRPC — wrap each call so a single broken
    // collection (or full gRPC outage) doesn't kill the page. -1 means
    // "unavailable" and the UI renders an em-dash.
    const counts = await Promise.all(
      collections.map(async (c) => {
        try {
          const coll = client.collections.get(c.name);
          const res = await coll.aggregate.overAll();
          return res.totalCount;
        } catch {
          return -1;
        }
      })
    );
    return collections
      .map<WeaviateCollectionSummary>((c, i) => ({
        name: c.name,
        description: c.description,
        objectCount: counts[i] ?? -1,
        vectorizer: extractVectorizer(c),
        propertyCount: Array.isArray(c.properties) ? c.properties.length : 0,
      }))
      .sort((a, b) => {
        // Treat unavailable counts as 0 for sort purposes — keeps healthy
        // collections at the top.
        const av = a.objectCount < 0 ? 0 : a.objectCount;
        const bv = b.objectCount < 0 ? 0 : b.objectCount;
        return bv - av;
      });
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function getOverview(
  config: WeaviateConfig
): Promise<WeaviateOverview> {
  const client = await createWeaviateClient(config);
  try {
    const meta = await client.getMeta();
    const collections = await client.collections.listAll();

    const counts = await Promise.all(
      collections.map(async (c) => {
        try {
          const coll = client.collections.get(c.name);
          const res = await coll.aggregate.overAll();
          return res.totalCount;
        } catch {
          return -1;
        }
      })
    );

    let totalObjects = 0;
    let partial = false;
    const summaries: WeaviateCollectionSummary[] = collections.map((c, i) => {
      const count = counts[i] ?? -1;
      if (count < 0) partial = true;
      else totalObjects += count;
      return {
        name: c.name,
        description: c.description,
        objectCount: count,
        vectorizer: extractVectorizer(c),
        propertyCount: Array.isArray(c.properties) ? c.properties.length : 0,
      };
    });
    summaries.sort((a, b) => {
      const av = a.objectCount < 0 ? 0 : a.objectCount;
      const bv = b.objectCount < 0 ? 0 : b.objectCount;
      return bv - av;
    });

    const moduleEntries = meta?.modules
      ? Object.keys(meta.modules as Record<string, unknown>)
      : [];

    const topCollectionsByObjects = summaries
      .filter((c) => c.objectCount >= 0)
      .slice(0, 5)
      .map((c) => ({ name: c.name, objects: c.objectCount }));

    return {
      url: config.url,
      version: meta?.version,
      hostname: meta?.hostname,
      moduleCount: moduleEntries.length,
      modules: moduleEntries,
      collectionCount: collections.length,
      totalObjects,
      partial,
      collections: summaries,
      topCollectionsByObjects,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function getCollectionDetail(
  config: WeaviateConfig,
  name: string
): Promise<WeaviateCollectionDetail> {
  const client = await createWeaviateClient(config);
  try {
    const coll = client.collections.get(name);
    // .config.get() is the v3 API for fetching a single collection's full config.
    const cfg = await coll.config.get();
    return {
      name,
      description:
        typeof (cfg as { description?: unknown }).description === "string"
          ? ((cfg as { description: string }).description)
          : undefined,
      vectorizer: extractVectorizer(cfg),
      properties: summarizeProperties(cfg),
      raw: cfg,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function sampleCollection(
  config: WeaviateConfig,
  name: string,
  options: { limit?: number; withVector?: boolean } = {}
): Promise<WeaviateObjectSummary[]> {
  const client = await createWeaviateClient(config);
  const limit = Math.min(Math.max(1, options.limit ?? 50), 100);
  try {
    const coll = client.collections.get(name);
    const res = await coll.query.fetchObjects({
      limit,
      includeVector: options.withVector ? true : undefined,
      returnMetadata: ["creationTime", "updateTime"],
    });
    return res.objects.map((o) => {
      // `vectors` is an object keyed by vector name → number[] (named vectors)
      // or a single default key for collections without named vectors.
      const vectors = o.vectors as Record<string, unknown> | undefined;
      let dims: number | undefined;
      if (vectors && typeof vectors === "object") {
        dims = Object.values(vectors).reduce(
          (acc: number, v) => acc + (Array.isArray(v) ? v.length : 0),
          0
        );
      }
      const metadata = o.metadata as
        | { creationTime?: Date; updateTime?: Date }
        | undefined;
      return {
        uuid: o.uuid,
        properties: (o.properties ?? {}) as Record<string, unknown>,
        vectorDimensions: dims,
        vectors: options.withVector ? vectors : undefined,
        creationTime:
          metadata?.creationTime instanceof Date
            ? metadata.creationTime.toISOString()
            : null,
        lastUpdateTime:
          metadata?.updateTime instanceof Date
            ? metadata.updateTime.toISOString()
            : null,
      };
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}
