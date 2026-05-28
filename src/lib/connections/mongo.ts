import "server-only";
import { MongoClient, type Document, type IndexSpecification, type CreateIndexesOptions } from "mongodb";
import { EJSON } from "bson";
import type { MongoConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Client cache
//
// One MongoClient per connection; the driver maintains its own pool. We
// invalidate lazily on URI change so editing the connection picks up new
// credentials without a manual reset.
// ─────────────────────────────────────────────────────────────────────────────

interface ClientBundle {
  hash: string;
  client: MongoClient;
}

const globalKey = Symbol.for("baklava.mongoClients");

function getCache(): Map<string, ClientBundle> {
  const g = globalThis as unknown as Record<symbol, Map<string, ClientBundle>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function hashConfig(cfg: MongoConfig): string {
  return JSON.stringify([cfg.uri, cfg.defaultDb ?? ""]);
}

async function bundleFor(
  connectionId: string,
  cfg: MongoConfig,
): Promise<ClientBundle> {
  const cache = getCache();
  const hash = hashConfig(cfg);
  const cached = cache.get(connectionId);
  if (cached && cached.hash === hash) return cached;
  if (cached) {
    try {
      await cached.client.close();
    } catch {
      // ignore
    }
  }
  const client = new MongoClient(cfg.uri, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
  });
  await client.connect();
  const bundle: ClientBundle = { hash, client };
  cache.set(connectionId, bundle);
  return bundle;
}

export function dropMongoClient(connectionId: string): void {
  const cache = getCache();
  const cached = cache.get(connectionId);
  if (!cached) return;
  cached.client.close().catch(() => {});
  cache.delete(connectionId);
}

// ─────────────────────────────────────────────────────────────────────────────
// EJSON helpers — round-trip Date/ObjectId/Decimal128/Long preserving type.
// ─────────────────────────────────────────────────────────────────────────────

/** Parse extended JSON; returns plain JS objects with BSON types instantiated. */
export function parseEjson<T = unknown>(s: string): T {
  if (!s?.trim()) return {} as T;
  return EJSON.parse(s, { relaxed: false }) as T;
}

/** Serialize using canonical EJSON so the UI shows {"$oid": "…"} explicitly. */
export function stringifyEjson(v: unknown, pretty = true): string {
  return EJSON.stringify(v, undefined, pretty ? 2 : undefined, { relaxed: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface ProbeResult {
  ok: true;
  version: string;
  topology: string;
  databases: number;
  totalSize: number;
}

export interface DatabaseRow {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
  collections?: number;
}

export interface CollectionRow {
  name: string;
  type: string;
  size: number;
  count: number;
  storageSize: number;
  indexes: number;
  avgObjSize: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe + listDatabases + listCollections
// ─────────────────────────────────────────────────────────────────────────────

export async function probe(
  connectionId: string,
  cfg: MongoConfig,
): Promise<ProbeResult> {
  const b = await bundleFor(connectionId, cfg);
  const admin = b.client.db("admin").admin();
  const [buildInfo, dbList, hello] = await Promise.all([
    admin.buildInfo().catch(() => ({ version: "unknown" })),
    admin.listDatabases().catch(() => ({ databases: [], totalSize: 0 })),
    b.client
      .db("admin")
      .command({ hello: 1 })
      .catch(() => ({ msg: "standalone" }) as Document),
  ]);
  const h = hello as {
    isWritablePrimary?: boolean;
    setName?: string;
    msg?: string;
  };
  const topology = h.isWritablePrimary
    ? h.setName
      ? `replica set: ${h.setName}`
      : "standalone"
    : h.msg === "isdbgrid"
      ? "sharded"
      : "standalone";
  return {
    ok: true,
    version: buildInfo.version ?? "unknown",
    topology,
    databases: dbList.databases?.length ?? 0,
    totalSize: dbList.totalSize ?? 0,
  };
}

export async function listDatabases(
  connectionId: string,
  cfg: MongoConfig,
): Promise<DatabaseRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const admin = b.client.db("admin").admin();
  const result = await admin.listDatabases();
  return (result.databases ?? []).map((d) => ({
    name: d.name,
    sizeOnDisk: d.sizeOnDisk ?? 0,
    empty: d.empty ?? false,
  }));
}

export async function listCollections(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
): Promise<CollectionRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const db = b.client.db(dbName);
  const meta = await db.listCollections().toArray();
  // collStats is expensive; we still call it per collection because the UI
  // wants size / count / index count at a glance. Parallel + best-effort.
  const rows = await Promise.all(
    meta.map(async (c) => {
      try {
        const stats = await db.command({ collStats: c.name });
        return {
          name: c.name,
          type: c.type ?? "collection",
          size: stats.size ?? 0,
          count: stats.count ?? 0,
          storageSize: stats.storageSize ?? 0,
          indexes: stats.nindexes ?? 0,
          avgObjSize: stats.avgObjSize ?? 0,
        };
      } catch {
        return {
          name: c.name,
          type: c.type ?? "collection",
          size: 0,
          count: 0,
          storageSize: 0,
          indexes: 0,
          avgObjSize: 0,
        };
      }
    }),
  );
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

export interface FindOptions {
  filter?: string; // EJSON
  projection?: string; // EJSON
  sort?: string; // EJSON
  skip?: number;
  limit?: number;
}

export interface FindResult {
  /** Documents serialized as canonical EJSON strings — UI renders verbatim. */
  documents: string[];
  /** Total matched documents (countDocuments), capped via skip/limit on read. */
  total: number;
  skip: number;
  limit: number;
}

export async function findDocuments(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  options: FindOptions = {},
): Promise<FindResult> {
  const b = await bundleFor(connectionId, cfg);
  const coll = b.client.db(dbName).collection(collName);
  const filter = (options.filter ? parseEjson<Document>(options.filter) : {}) as Document;
  const projection = options.projection
    ? parseEjson<Document>(options.projection)
    : undefined;
  const sort = options.sort
    ? parseEjson<Document>(options.sort)
    : undefined;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const skip = Math.max(options.skip ?? 0, 0);

  const cursor = coll.find(filter, { projection, sort, limit, skip });
  const [docs, total] = await Promise.all([
    cursor.toArray(),
    coll.countDocuments(filter).catch(() => 0),
  ]);
  return {
    documents: docs.map((d) => stringifyEjson(d)),
    total,
    skip,
    limit,
  };
}

export async function insertDocument(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  ejson: string,
): Promise<{ insertedId: string }> {
  const b = await bundleFor(connectionId, cfg);
  const doc = parseEjson<Document>(ejson);
  const res = await b.client.db(dbName).collection(collName).insertOne(doc);
  return { insertedId: stringifyEjson(res.insertedId, false) };
}

export async function replaceDocument(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  filterEjson: string,
  documentEjson: string,
): Promise<{ matched: number; modified: number }> {
  const b = await bundleFor(connectionId, cfg);
  const filter = parseEjson<Document>(filterEjson);
  const replacement = parseEjson<Document>(documentEjson);
  // Mongo refuses _id in $set / replacement, so strip it if present and rely
  // on the filter to pin the target.
  if ("_id" in replacement) delete (replacement as { _id?: unknown })._id;
  const res = await b.client
    .db(dbName)
    .collection(collName)
    .replaceOne(filter, replacement);
  return { matched: res.matchedCount, modified: res.modifiedCount };
}

export async function deleteDocument(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  filterEjson: string,
): Promise<{ deleted: number }> {
  const b = await bundleFor(connectionId, cfg);
  const filter = parseEjson<Document>(filterEjson);
  const res = await b.client
    .db(dbName)
    .collection(collName)
    .deleteOne(filter);
  return { deleted: res.deletedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Indexes
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexRow {
  name: string;
  keys: string; // EJSON
  unique: boolean;
  sparse: boolean;
  ttl?: number;
  partial: boolean;
  size?: number;
}

export async function listIndexes(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
): Promise<IndexRow[]> {
  const b = await bundleFor(connectionId, cfg);
  const db = b.client.db(dbName);
  const coll = db.collection(collName);
  const idx = await coll.indexes();
  let sizes: Record<string, number> = {};
  try {
    const stats = await db.command({ collStats: collName });
    sizes = (stats.indexSizes ?? {}) as Record<string, number>;
  } catch {
    // ignore — sizes are best-effort
  }
  return idx.map((i) => ({
    name: i.name ?? "?",
    keys: stringifyEjson(i.key ?? {}, false),
    unique: Boolean(i.unique),
    sparse: Boolean(i.sparse),
    ttl: typeof i.expireAfterSeconds === "number" ? i.expireAfterSeconds : undefined,
    partial: Boolean(i.partialFilterExpression),
    size: i.name ? sizes[i.name] : undefined,
  }));
}

export interface CreateIndexInput {
  keysEjson: string;
  options?: {
    name?: string;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: string; // EJSON
  };
}

export async function createIndex(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  input: CreateIndexInput,
): Promise<{ name: string }> {
  const b = await bundleFor(connectionId, cfg);
  const keys = parseEjson<IndexSpecification>(input.keysEjson);
  const opts: CreateIndexesOptions = {};
  if (input.options?.name) opts.name = input.options.name;
  if (input.options?.unique) opts.unique = true;
  if (input.options?.sparse) opts.sparse = true;
  if (typeof input.options?.expireAfterSeconds === "number") {
    opts.expireAfterSeconds = input.options.expireAfterSeconds;
  }
  if (input.options?.partialFilterExpression) {
    opts.partialFilterExpression = parseEjson<Document>(
      input.options.partialFilterExpression,
    );
  }
  const name = await b.client
    .db(dbName)
    .collection(collName)
    .createIndex(keys, opts);
  return { name };
}

export async function dropIndex(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  indexName: string,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  await b.client.db(dbName).collection(collName).dropIndex(indexName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate
// ─────────────────────────────────────────────────────────────────────────────

export interface AggregateResult {
  /** EJSON-serialized result documents. */
  documents: string[];
  /** Whether the cursor was truncated at the limit. */
  truncated: boolean;
}

const AGG_HARD_LIMIT = 500;

export async function runAggregate(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  pipelineEjson: string,
): Promise<AggregateResult> {
  const b = await bundleFor(connectionId, cfg);
  const pipeline = parseEjson<Document[]>(pipelineEjson);
  if (!Array.isArray(pipeline)) {
    throw new Error("Pipeline must be a JSON array of stages");
  }
  const cursor = b.client
    .db(dbName)
    .collection(collName)
    .aggregate(pipeline, { maxTimeMS: 30_000 });
  const docs: Document[] = [];
  let truncated = false;
  for await (const doc of cursor) {
    if (docs.length >= AGG_HARD_LIMIT) {
      truncated = true;
      break;
    }
    docs.push(doc);
  }
  await cursor.close();
  return {
    documents: docs.map((d) => stringifyEjson(d)),
    truncated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Server status / db stats
// ─────────────────────────────────────────────────────────────────────────────

export async function serverStatus(
  connectionId: string,
  cfg: MongoConfig,
): Promise<Record<string, unknown>> {
  const b = await bundleFor(connectionId, cfg);
  const status = await b.client.db("admin").command({ serverStatus: 1 });
  return status as Record<string, unknown>;
}

export async function dbStats(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
): Promise<Record<string, unknown>> {
  const b = await bundleFor(connectionId, cfg);
  return (await b.client.db(dbName).stats()) as Record<string, unknown>;
}
