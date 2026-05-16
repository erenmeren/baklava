import { QdrantClient } from "@qdrant/js-client-rest";
import type { QdrantConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Client factory
//
// The Qdrant REST client opens a fresh HTTP connection per request — there is
// no .close()/.disconnect() to call. We still build a fresh client per helper
// invocation to keep the connect-try-finally shape consistent with the rest
// of the drivers (Kafka, Mongo, …).
// ─────────────────────────────────────────────────────────────────────────────

export function createQdrantClient(config: QdrantConfig): QdrantClient {
  return new QdrantClient({
    url: config.url,
    apiKey: config.apiKey || undefined,
    // The compatibility check pings GET /, which is slow and noisy in dev.
    checkCompatibility: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────────────

export type QdrantDistance = "Cosine" | "Euclid" | "Dot" | "Manhattan";

export interface QdrantVectorParamSummary {
  /** Unnamed vector key is rendered as "default" in the UI. */
  name: string;
  size: number;
  distance: QdrantDistance | string;
  onDisk?: boolean;
}

export interface QdrantCollectionSummary {
  name: string;
  vectorsCount: number;
  pointsCount: number;
  segmentsCount: number;
  status: string;
  optimizerStatus: string;
  /** Aggregated dimension across all named vectors (max if multiple). */
  vectorSize: number;
  /** Primary distance metric — first named vector's distance. */
  distance: string;
  vectors: QdrantVectorParamSummary[];
}

export interface QdrantProbeResult {
  collectionCount: number;
}

export interface QdrantOverview {
  url: string;
  collectionCount: number;
  totalVectors: number;
  totalPoints: number;
  totalSegments: number;
  /** Combined: green / yellow / grey / red — worst wins. */
  status: string;
  collections: QdrantCollectionSummary[];
  topCollectionsByVectors: { name: string; vectors: number }[];
}

export interface QdrantPointSummary {
  id: string | number;
  payload: Record<string, unknown> | null;
  vector?: unknown;
  vectorDimensions?: number;
}

export interface QdrantCollectionDetail {
  name: string;
  vectorsCount: number;
  pointsCount: number;
  segmentsCount: number;
  indexedVectorsCount: number;
  status: string;
  optimizerStatus: string;
  vectors: QdrantVectorParamSummary[];
  payloadSchema: { key: string; dataType: string; points?: number }[];
  /** Full upstream JSON, for the Config tab DetailBlock. */
  raw: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeOptimizerStatus(s: unknown): string {
  if (s == null) return "unknown";
  if (typeof s === "string") return s;
  if (typeof s === "object" && s && "error" in (s as Record<string, unknown>)) {
    return `error: ${String((s as { error: unknown }).error)}`;
  }
  return JSON.stringify(s);
}

function vectorsConfigToArray(vectors: unknown): QdrantVectorParamSummary[] {
  if (!vectors || typeof vectors !== "object") return [];
  const obj = vectors as Record<string, unknown> & {
    size?: number;
    distance?: string;
    on_disk?: boolean;
  };
  // Single anonymous config: { size, distance, … }
  if (typeof obj.size === "number" && typeof obj.distance === "string") {
    return [
      {
        name: "default",
        size: obj.size,
        distance: obj.distance,
        onDisk: obj.on_disk,
      },
    ];
  }
  // Named-vector map: { name: { size, distance, … } }
  const out: QdrantVectorParamSummary[] = [];
  for (const [name, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      const cfg = v as { size?: number; distance?: string; on_disk?: boolean };
      if (typeof cfg.size === "number") {
        out.push({
          name,
          size: cfg.size,
          distance: cfg.distance ?? "unknown",
          onDisk: cfg.on_disk,
        });
      }
    }
  }
  return out;
}

// Combine collection statuses — `red` is the worst, then yellow/grey, then green.
const STATUS_RANK: Record<string, number> = {
  red: 4,
  yellow: 3,
  grey: 2,
  green: 1,
};

function worstStatus(statuses: string[]): string {
  if (statuses.length === 0) return "unknown";
  let worst = "green";
  for (const s of statuses) {
    if ((STATUS_RANK[s] ?? 0) > (STATUS_RANK[worst] ?? 0)) worst = s;
  }
  return worst;
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe / overview / list / detail / sample
// ─────────────────────────────────────────────────────────────────────────────

export async function probeQdrant(
  config: QdrantConfig
): Promise<QdrantProbeResult> {
  const client = createQdrantClient(config);
  const res = await client.getCollections();
  return { collectionCount: res.collections?.length ?? 0 };
}

async function describeOne(
  client: QdrantClient,
  name: string
): Promise<QdrantCollectionSummary> {
  const info = await client.getCollection(name);
  const vectors = vectorsConfigToArray(info.config?.params?.vectors);
  const vectorSize = vectors.reduce((m, v) => Math.max(m, v.size), 0);
  const distance = vectors[0]?.distance ?? "unknown";
  return {
    name,
    vectorsCount: Number(info.indexed_vectors_count ?? 0),
    pointsCount: Number(info.points_count ?? 0),
    segmentsCount: Number(info.segments_count ?? 0),
    status: String(info.status ?? "unknown"),
    optimizerStatus: normalizeOptimizerStatus(info.optimizer_status),
    vectorSize,
    distance,
    vectors,
  };
}

export async function listCollections(
  config: QdrantConfig
): Promise<QdrantCollectionSummary[]> {
  const client = createQdrantClient(config);
  const { collections } = await client.getCollections();
  const names = (collections ?? []).map((c) => c.name);
  // Hit getCollection in parallel — capped by undici keep-alive pool.
  const results = await Promise.all(
    names.map((n) =>
      describeOne(client, n).catch<QdrantCollectionSummary>((err) => ({
        name: n,
        vectorsCount: 0,
        pointsCount: 0,
        segmentsCount: 0,
        status: "error",
        optimizerStatus: err instanceof Error ? err.message : String(err),
        vectorSize: 0,
        distance: "unknown",
        vectors: [],
      }))
    )
  );
  return results.sort((a, b) => b.vectorsCount - a.vectorsCount);
}

export async function getOverview(
  config: QdrantConfig
): Promise<QdrantOverview> {
  const collections = await listCollections(config);
  let totalVectors = 0;
  let totalPoints = 0;
  let totalSegments = 0;
  for (const c of collections) {
    totalVectors += c.vectorsCount;
    totalPoints += c.pointsCount;
    totalSegments += c.segmentsCount;
  }
  const status = worstStatus(collections.map((c) => c.status));
  const topCollectionsByVectors = [...collections]
    .sort((a, b) => b.vectorsCount - a.vectorsCount)
    .slice(0, 5)
    .map((c) => ({ name: c.name, vectors: c.vectorsCount }));
  return {
    url: config.url,
    collectionCount: collections.length,
    totalVectors,
    totalPoints,
    totalSegments,
    status,
    collections,
    topCollectionsByVectors,
  };
}

export async function getCollectionDetail(
  config: QdrantConfig,
  name: string
): Promise<QdrantCollectionDetail> {
  const client = createQdrantClient(config);
  const info = await client.getCollection(name);
  const vectors = vectorsConfigToArray(info.config?.params?.vectors);
  const payloadSchema = Object.entries(info.payload_schema ?? {}).map(
    ([key, v]) => ({
      key,
      dataType: String(v?.data_type ?? "unknown"),
      points: typeof v?.points === "number" ? v.points : undefined,
    })
  );
  return {
    name,
    vectorsCount: Number(info.indexed_vectors_count ?? 0),
    pointsCount: Number(info.points_count ?? 0),
    segmentsCount: Number(info.segments_count ?? 0),
    indexedVectorsCount: Number(info.indexed_vectors_count ?? 0),
    status: String(info.status ?? "unknown"),
    optimizerStatus: normalizeOptimizerStatus(info.optimizer_status),
    vectors,
    payloadSchema,
    raw: info,
  };
}

// `scroll` walks the collection deterministically without scoring — perfect
// for a "show me 50 rows" sample. `search` requires a query vector and ranks
// by distance, so it's not what we want for browsing.
export async function sampleCollection(
  config: QdrantConfig,
  name: string,
  options: { limit?: number; withVector?: boolean } = {}
): Promise<QdrantPointSummary[]> {
  const client = createQdrantClient(config);
  const limit = Math.min(Math.max(1, options.limit ?? 50), 100);
  const res = await client.scroll(name, {
    limit,
    with_payload: true,
    with_vector: Boolean(options.withVector),
  });
  const out: QdrantPointSummary[] = [];
  for (const p of res.points ?? []) {
    const vec = (p as { vector?: unknown }).vector;
    let dims: number | undefined;
    if (Array.isArray(vec)) dims = vec.length;
    else if (vec && typeof vec === "object") {
      // Named vectors: { vec1: [...], vec2: [...] } — sum dimensions.
      dims = Object.values(vec as Record<string, unknown>).reduce(
        (acc: number, v) => acc + (Array.isArray(v) ? v.length : 0),
        0
      );
    }
    out.push({
      id: p.id as string | number,
      payload: (p.payload ?? null) as Record<string, unknown> | null,
      vector: options.withVector ? vec : undefined,
      vectorDimensions: dims,
    });
  }
  return out;
}
