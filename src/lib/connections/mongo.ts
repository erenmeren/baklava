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

// ─────────────────────────────────────────────────────────────────────────────
// Schema inference
//
// Compass's killer feature. We $sample N docs and walk each one, recording
// every (path, type, presence) so the UI can render a tree of fields with
// type distribution and one example value per type.
// ─────────────────────────────────────────────────────────────────────────────

export interface SchemaField {
  path: string;
  types: { type: string; count: number; sample: string }[];
  presence: number; // 0..1
  totalSeen: number;
}

function bsonTypeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (v instanceof Date) return "date";
  const t = typeof v;
  if (t === "object") {
    const ctor = (v as { _bsontype?: string })?._bsontype;
    if (ctor) return ctor.toLowerCase(); // ObjectId, Decimal128, Long, etc.
    return "object";
  }
  if (t === "number") {
    return Number.isInteger(v) ? "int" : "double";
  }
  return t;
}

function walkDoc(
  doc: unknown,
  path: string,
  fields: Map<string, SchemaField>,
  sampleSize: number,
): void {
  if (doc === null || doc === undefined) return;
  if (typeof doc !== "object") return;
  if (Array.isArray(doc)) return;
  for (const [k, raw] of Object.entries(doc as Record<string, unknown>)) {
    const nextPath = path ? `${path}.${k}` : k;
    const type = bsonTypeOf(raw);
    let entry = fields.get(nextPath);
    if (!entry) {
      entry = { path: nextPath, types: [], presence: 0, totalSeen: sampleSize };
      fields.set(nextPath, entry);
    }
    const existing = entry.types.find((t) => t.type === type);
    if (existing) {
      existing.count += 1;
    } else {
      // Sample value — stringified short form so the UI can render verbatim.
      let sample = "";
      try {
        sample = stringifyEjson(raw, false);
      } catch {
        sample = String(raw);
      }
      if (sample.length > 80) sample = sample.slice(0, 77) + "…";
      entry.types.push({ type, count: 1, sample });
    }
    entry.presence += 1;
    if (type === "object") {
      walkDoc(raw, nextPath, fields, sampleSize);
    }
  }
}

export interface SchemaResult {
  sampleSize: number;
  fields: SchemaField[];
}

export async function sampleSchema(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  sampleSize = 500,
): Promise<SchemaResult> {
  const b = await bundleFor(connectionId, cfg);
  const size = Math.min(Math.max(sampleSize, 10), 5000);
  const cursor = b.client
    .db(dbName)
    .collection(collName)
    .aggregate([{ $sample: { size } }], { maxTimeMS: 30_000 });
  const fields = new Map<string, SchemaField>();
  let actual = 0;
  for await (const doc of cursor) {
    walkDoc(doc, "", fields, size);
    actual += 1;
  }
  await cursor.close();
  // Recompute presence against ACTUAL sample count (may be less if coll is small)
  for (const f of fields.values()) {
    f.totalSeen = actual;
    f.presence = actual ? f.presence / actual : 0;
  }
  const out = [...fields.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { sampleSize: actual, fields: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// Explain
// ─────────────────────────────────────────────────────────────────────────────

export type ExplainVerbosity =
  | "queryPlanner"
  | "executionStats"
  | "allPlansExecution";

export async function explainFind(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  filterEjson: string,
  verbosity: ExplainVerbosity = "executionStats",
): Promise<Record<string, unknown>> {
  const b = await bundleFor(connectionId, cfg);
  const filter = filterEjson ? parseEjson<Document>(filterEjson) : ({} as Document);
  const result = await b.client
    .db(dbName)
    .command({
      explain: { find: collName, filter },
      verbosity,
    });
  return result as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Distinct values
// ─────────────────────────────────────────────────────────────────────────────

export async function distinctValues(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
  field: string,
  filterEjson?: string,
): Promise<string[]> {
  const b = await bundleFor(connectionId, cfg);
  const filter = filterEjson ? parseEjson<Document>(filterEjson) : ({} as Document);
  const values = await b.client
    .db(dbName)
    .collection(collName)
    .distinct(field, filter);
  return values.map((v) => stringifyEjson(v, false));
}

// ─────────────────────────────────────────────────────────────────────────────
// Index usage stats — $indexStats
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexUsage {
  name: string;
  ops: number;
  since: string;
}

export async function indexUsage(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
): Promise<IndexUsage[]> {
  const b = await bundleFor(connectionId, cfg);
  const stats = await b.client
    .db(dbName)
    .collection(collName)
    .aggregate([{ $indexStats: {} }])
    .toArray();
  return stats.map((s) => ({
    name: String(s.name ?? "?"),
    ops: Number((s.accesses as { ops?: number })?.ops ?? 0),
    since: stringifyEjson((s.accesses as { since?: unknown })?.since ?? "", false),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Collection lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateCollectionInput {
  name: string;
  capped?: boolean;
  size?: number; // bytes, for capped
  max?: number; // doc count, for capped
  validatorEjson?: string;
  validationLevel?: "off" | "strict" | "moderate";
}

export async function createCollectionOp(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  input: CreateCollectionInput,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  const options: Record<string, unknown> = {};
  if (input.capped) {
    options.capped = true;
    if (typeof input.size === "number") options.size = input.size;
    if (typeof input.max === "number") options.max = input.max;
  }
  if (input.validatorEjson?.trim()) {
    options.validator = parseEjson<Document>(input.validatorEjson);
    if (input.validationLevel) options.validationLevel = input.validationLevel;
  }
  await b.client.db(dbName).createCollection(input.name, options);
}

export async function dropCollectionOp(
  connectionId: string,
  cfg: MongoConfig,
  dbName: string,
  collName: string,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  await b.client.db(dbName).dropCollection(collName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Currently-running operations
// ─────────────────────────────────────────────────────────────────────────────

export interface CurrentOp {
  opid: string;
  type: string;
  op: string;
  ns: string;
  secs_running: number;
  microsecs_running: number;
  client?: string;
  desc?: string;
  command?: string;
  waitingForLock?: boolean;
}

export async function currentOps(
  connectionId: string,
  cfg: MongoConfig,
  options: { active?: boolean; includeIdle?: boolean } = {},
): Promise<CurrentOp[]> {
  const b = await bundleFor(connectionId, cfg);
  const result = await b.client.db("admin").command({
    currentOp: 1,
    $all: options.includeIdle ?? false,
    $ownOps: false,
    active: options.active ?? true,
  });
  const list = ((result as { inprog?: Record<string, unknown>[] }).inprog ?? []) as Record<string, unknown>[];
  return list.map((o) => ({
    opid: String(o.opid ?? ""),
    type: String(o.type ?? "op"),
    op: String(o.op ?? ""),
    ns: String(o.ns ?? ""),
    secs_running: Number(o.secs_running ?? 0),
    microsecs_running: Number(o.microsecs_running ?? 0),
    client: o.client ? String(o.client) : undefined,
    desc: o.desc ? String(o.desc) : undefined,
    command: o.command ? stringifyEjson(o.command, false) : undefined,
    waitingForLock: Boolean(o.waitingForLock),
  }));
}

export async function killOp(
  connectionId: string,
  cfg: MongoConfig,
  opid: string,
): Promise<void> {
  const b = await bundleFor(connectionId, cfg);
  // opid is a stringified number for non-cluster, "shard:opid" for cluster.
  const parsed = Number(opid);
  await b.client.db("admin").command({
    killOp: 1,
    op: Number.isFinite(parsed) ? parsed : opid,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Replica set status
// ─────────────────────────────────────────────────────────────────────────────

export interface ReplMember {
  name: string;
  state: string;
  health: number;
  uptime: number;
  optimeDate: string;
  lagSeconds: number;
  isSelf: boolean;
}

const STATE_NAMES: Record<number, string> = {
  0: "STARTUP",
  1: "PRIMARY",
  2: "SECONDARY",
  3: "RECOVERING",
  5: "STARTUP2",
  6: "UNKNOWN",
  7: "ARBITER",
  8: "DOWN",
  9: "ROLLBACK",
  10: "REMOVED",
};

export interface ReplStatus {
  set?: string;
  myState?: number;
  members: ReplMember[];
}

export async function replSetStatus(
  connectionId: string,
  cfg: MongoConfig,
): Promise<ReplStatus> {
  const b = await bundleFor(connectionId, cfg);
  const status = (await b.client
    .db("admin")
    .command({ replSetGetStatus: 1 })) as {
    set?: string;
    myState?: number;
    members?: Record<string, unknown>[];
    date?: Date;
  };
  const now =
    status.date instanceof Date ? status.date.getTime() : Date.now();
  const primary = (status.members ?? []).find(
    (m) => (m.state as number) === 1,
  );
  const primaryOptime =
    primary?.optimeDate instanceof Date
      ? primary.optimeDate.getTime()
      : null;
  return {
    set: status.set,
    myState: status.myState,
    members: (status.members ?? []).map((m) => {
      const optimeDate = m.optimeDate instanceof Date ? m.optimeDate : null;
      const lag = optimeDate && primaryOptime
        ? Math.max(0, (primaryOptime - optimeDate.getTime()) / 1000)
        : 0;
      return {
        name: String(m.name ?? ""),
        state: STATE_NAMES[Number(m.state)] ?? `STATE_${m.state}`,
        health: Number(m.health ?? 0),
        uptime: Number(m.uptime ?? 0),
        optimeDate: optimeDate ? optimeDate.toISOString() : "",
        lagSeconds: Math.round(lag),
        isSelf: Boolean(m.self),
      };
    }),
    // expose lastUpdateMs for the UI to know how stale the snapshot is
    ...({ asOf: now } as Record<string, unknown>),
  };
}

