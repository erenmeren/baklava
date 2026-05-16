import {
  MilvusClient,
  DataType,
  LoadState,
  type FieldSchema,
} from "@zilliz/milvus2-sdk-node";
import type { MilvusConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Client lifecycle — gRPC channels MUST be closed in finally or the Node
// process will keep a handle open and the dev server will hang on shutdown.
// ─────────────────────────────────────────────────────────────────────────────

function createMilvusClient(config: MilvusConfig): MilvusClient {
  return new MilvusClient({
    address: config.address,
    ssl: Boolean(config.ssl),
    token: config.token || undefined,
    timeout: 8000,
  });
}

async function withClient<T>(
  config: MilvusConfig,
  fn: (client: MilvusClient) => Promise<T>
): Promise<T> {
  const client = createMilvusClient(config);
  try {
    return await fn(client);
  } finally {
    await client.closeConnection().catch(() => undefined);
  }
}

// Recognise "collection not loaded" errors from the various places they bubble
// up so the UI can surface a friendly empty state.
const NOT_LOADED_PATTERNS = [
  /not loaded/i,
  /collection not loaded/i,
  /not.*been loaded/i,
  /LoadStateNotLoad/,
];

export function isNotLoadedError(err: unknown): boolean {
  if (!err) return false;
  const message =
    err instanceof Error
      ? `${err.message} ${(err as Error & { reason?: string }).reason ?? ""}`
      : String(err);
  return NOT_LOADED_PATTERNS.some((re) => re.test(message));
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe
// ─────────────────────────────────────────────────────────────────────────────

export interface MilvusProbeResult {
  serverVersion: string;
  collectionCount: number;
}

export async function probeMilvus(
  config: MilvusConfig
): Promise<MilvusProbeResult> {
  return withClient(config, async (client) => {
    const version = await client.getVersion();
    const list = await client.listCollections();
    return {
      serverVersion: version?.version || "unknown",
      collectionCount: list.data?.length ?? 0,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview (mission-control)
// ─────────────────────────────────────────────────────────────────────────────

export interface MilvusCollectionStat {
  name: string;
  id: string;
  rowCount: number;
  loaded: boolean;
  loadState: string;
  description: string;
}

export interface MilvusClusterSummary {
  address: string;
  serverVersion: string;
  collectionCount: number;
  loadedCount: number;
  totalRows: number;
  topCollections: { name: string; rowCount: number }[];
  collections: MilvusCollectionStat[];
}

type StatsKV = { key: string; value: string | number };

function parseRowCount(stats?: StatsKV[]): number {
  if (!stats) return 0;
  const row = stats.find((s) => s.key === "row_count");
  if (!row) return 0;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : 0;
}

function normaliseStats(stats?: StatsKV[]): { key: string; value: string }[] {
  if (!stats) return [];
  return stats.map((s) => ({ key: s.key, value: String(s.value) }));
}

export async function getMilvusSummary(
  config: MilvusConfig
): Promise<MilvusClusterSummary> {
  return withClient(config, async (client) => {
    const version = await client.getVersion();
    const list = await client.listCollections();
    const names = (list.data ?? []).map((c) => c.name);

    const collections = await Promise.all(
      names.map(async (name) => {
        const [stats, loadState, desc] = await Promise.all([
          client
            .getCollectionStatistics({ collection_name: name })
            .catch(() => undefined),
          client
            .getLoadState({ collection_name: name })
            .catch(() => undefined),
          client
            .describeCollection({ collection_name: name })
            .catch(() => undefined),
        ]);
        const rowCount = parseRowCount(stats?.stats as StatsKV[] | undefined);
        const state = loadState?.state ?? "unknown";
        return {
          name,
          id: String(desc?.collectionID ?? ""),
          rowCount,
          loaded: state === LoadState.LoadStateLoaded,
          loadState: String(state),
          description: desc?.schema?.description ?? "",
        } satisfies MilvusCollectionStat;
      })
    );

    const totalRows = collections.reduce((s, c) => s + c.rowCount, 0);
    const loadedCount = collections.filter((c) => c.loaded).length;
    const topCollections = [...collections]
      .sort((a, b) => b.rowCount - a.rowCount)
      .slice(0, 5)
      .map((c) => ({ name: c.name, rowCount: c.rowCount }));

    return {
      address: config.address,
      serverVersion: version?.version || "unknown",
      collectionCount: collections.length,
      loadedCount,
      totalRows,
      topCollections,
      collections: collections.sort((a, b) => b.rowCount - a.rowCount),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Collections listing (primary browse)
// ─────────────────────────────────────────────────────────────────────────────

export async function listMilvusCollections(
  config: MilvusConfig
): Promise<MilvusCollectionStat[]> {
  const summary = await getMilvusSummary(config);
  return summary.collections;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection detail
// ─────────────────────────────────────────────────────────────────────────────

export interface MilvusFieldDescriptor {
  name: string;
  dataType: string;
  isPrimary: boolean;
  autoId: boolean;
  isPartitionKey: boolean;
  nullable: boolean;
  description: string;
  dimension: number | null;
  maxLength: number | null;
  elementType: string | null;
}

export interface MilvusIndexDescriptor {
  fieldName: string;
  indexName: string;
  indexType: string;
  metricType: string;
  params: Record<string, string>;
}

export interface MilvusCollectionDetail {
  name: string;
  id: string;
  description: string;
  autoId: boolean;
  enableDynamicField: boolean;
  consistencyLevel: string;
  loaded: boolean;
  loadState: string;
  fields: MilvusFieldDescriptor[];
  stats: { key: string; value: string }[];
  indexes: MilvusIndexDescriptor[];
}

function typeParamValue(
  field: FieldSchema,
  key: string
): string | undefined {
  // type_params is an array of {key, value}; some keys are also mirrored on
  // the field as direct properties — check both for robustness.
  const fromArray = field.type_params?.find((p) => p.key === key)?.value;
  if (fromArray != null) return String(fromArray);
  const fromDirect = (field as unknown as Record<string, unknown>)[key];
  if (fromDirect != null) return String(fromDirect);
  return undefined;
}

function describeField(field: FieldSchema): MilvusFieldDescriptor {
  const dim = typeParamValue(field, "dim");
  const maxLength = typeParamValue(field, "max_length");
  return {
    name: field.name,
    dataType: String(field.data_type ?? field.dataType ?? "Unknown"),
    isPrimary: Boolean(field.is_primary_key),
    autoId: Boolean(field.autoID),
    isPartitionKey: Boolean(field.is_partition_key),
    nullable: Boolean(field.nullable),
    description: field.description ?? "",
    dimension: dim ? Number(dim) : null,
    maxLength: maxLength ? Number(maxLength) : null,
    elementType: field.element_type ? String(field.element_type) : null,
  };
}

export async function describeMilvusCollection(
  config: MilvusConfig,
  name: string
): Promise<MilvusCollectionDetail> {
  return withClient(config, async (client) => {
    const [desc, stats, loadState] = await Promise.all([
      client.describeCollection({ collection_name: name }),
      client
        .getCollectionStatistics({ collection_name: name })
        .catch(() => undefined),
      client
        .getLoadState({ collection_name: name })
        .catch(() => undefined),
    ]);

    // describeIndex throws if no indexes exist — swallow so detail still loads
    let indexes: MilvusIndexDescriptor[] = [];
    try {
      const idx = await client.describeIndex({ collection_name: name });
      indexes =
        idx.index_descriptions?.map((d) => {
          const params: Record<string, string> = {};
          let indexType = "";
          let metricType = "";
          for (const p of d.params ?? []) {
            if (p.key === "index_type") indexType = String(p.value);
            else if (p.key === "metric_type") metricType = String(p.value);
            else params[p.key] = String(p.value);
          }
          return {
            fieldName: d.field_name,
            indexName: d.index_name,
            indexType,
            metricType,
            params,
          } satisfies MilvusIndexDescriptor;
        }) ?? [];
    } catch {
      indexes = [];
    }

    const state = loadState?.state ?? "unknown";
    return {
      name,
      id: String(desc.collectionID ?? ""),
      description: desc.schema?.description ?? "",
      autoId: Boolean(desc.schema?.autoID),
      enableDynamicField: Boolean(desc.schema?.enable_dynamic_field),
      consistencyLevel: String(desc.consistency_level ?? ""),
      loaded: state === LoadState.LoadStateLoaded,
      loadState: String(state),
      fields: (desc.schema?.fields ?? []).map(describeField),
      stats: normaliseStats(stats?.stats as StatsKV[] | undefined),
      indexes,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sample rows — vectors stripped down to a dimension count
// ─────────────────────────────────────────────────────────────────────────────

export interface MilvusSampleRow {
  /** Field name → JSON-safe display value. Vector fields show "[float × N]". */
  display: Record<string, unknown>;
  /** Full vector field values (first/last 10 dims only, plus total). */
  vectors: Record<
    string,
    { dim: number; head: number[]; tail: number[] }
  >;
}

export interface MilvusSampleResult {
  rows: MilvusSampleRow[];
  /** Set when the collection isn't loaded — UI surfaces an empty state. */
  notLoaded?: boolean;
  /** Friendly note (e.g. "Collection has no rows") when applicable. */
  note?: string;
}

const VECTOR_TYPES = new Set([
  "FloatVector",
  "BinaryVector",
  "Float16Vector",
  "BFloat16Vector",
  "SparseFloatVector",
  "Int8Vector",
  String(DataType.FloatVector),
  String(DataType.BinaryVector),
  String(DataType.Float16Vector),
  String(DataType.BFloat16Vector),
  String(DataType.SparseFloatVector),
]);

function isVectorField(field: MilvusFieldDescriptor): boolean {
  return VECTOR_TYPES.has(field.dataType) || field.dataType.endsWith("Vector");
}

function summariseVector(value: unknown): {
  dim: number;
  head: number[];
  tail: number[];
} {
  if (Array.isArray(value)) {
    const dim = value.length;
    const head = value.slice(0, 10).map((v) => Number(v));
    const tail = dim > 20 ? value.slice(dim - 10).map((v) => Number(v)) : [];
    return { dim, head, tail };
  }
  // Sparse vector or buffer — render whatever we can
  return { dim: 0, head: [], tail: [] };
}

export async function sampleMilvusCollection(
  config: MilvusConfig,
  name: string,
  limit: number
): Promise<MilvusSampleResult> {
  const cappedLimit = Math.max(1, Math.min(100, limit));
  return withClient(config, async (client) => {
    // Pre-flight: is it loaded? Saves us a query that would just throw.
    const loadState = await client
      .getLoadState({ collection_name: name })
      .catch(() => undefined);
    if (loadState && loadState.state !== LoadState.LoadStateLoaded) {
      return {
        rows: [],
        notLoaded: true,
        note: "Collection is not loaded into memory. Load it via the Milvus client or admin tool before browsing rows.",
      };
    }

    // Need the schema so we know which fields are vectors.
    const desc = await client.describeCollection({ collection_name: name });
    const fields = (desc.schema?.fields ?? []).map(describeField);
    const vectorFieldNames = new Set(
      fields.filter(isVectorField).map((f) => f.name)
    );

    try {
      // Milvus 2.3+ accepts an empty `expr` paired with `limit` for browsing.
      // output_fields: ["*"] returns every scalar; vector fields must be named.
      const vectorList = [...vectorFieldNames];
      const queryRes = await client.query({
        collection_name: name,
        expr: "",
        limit: cappedLimit,
        output_fields:
          vectorList.length > 0 ? ["*", ...vectorList] : ["*"],
      });

      const dataRows: Record<string, unknown>[] =
        (queryRes as unknown as { data?: Record<string, unknown>[] }).data ??
        [];

      const rows = dataRows.map<MilvusSampleRow>((row) => {
        const display: Record<string, unknown> = {};
        const vectors: MilvusSampleRow["vectors"] = {};
        for (const [k, v] of Object.entries(row)) {
          if (vectorFieldNames.has(k)) {
            const summary = summariseVector(v);
            vectors[k] = summary;
            display[k] = `[float × ${summary.dim}]`;
          } else if (typeof v === "bigint") {
            display[k] = v.toString();
          } else {
            display[k] = v;
          }
        }
        return { display, vectors };
      });

      return {
        rows,
        note:
          rows.length === 0 ? "Collection is loaded but empty." : undefined,
      };
    } catch (err) {
      if (isNotLoadedError(err)) {
        return {
          rows: [],
          notLoaded: true,
          note: "Collection is not loaded into memory. Load it via the Milvus client or admin tool before browsing rows.",
        };
      }
      throw err;
    }
  });
}
