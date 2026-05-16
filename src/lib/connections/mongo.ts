import { MongoClient, type Document } from "mongodb";
import type { MongoConfig } from "./types";

const SYSTEM_DBS = new Set(["admin", "local", "config"]);

/**
 * Build a MongoDB connection URI from the config. The `uri` field wins if set;
 * otherwise we synthesize one from host/port/user/password/authSource/tls.
 */
export function buildMongoUri(config: MongoConfig): string {
  if (config.uri && config.uri.trim()) {
    return config.uri.trim();
  }
  const host = config.host || "localhost";
  const port = config.port || 27017;
  const proto = "mongodb://";
  const auth =
    config.user && config.user.length > 0
      ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password ?? "")}@`
      : "";
  const db = config.database ? `/${encodeURIComponent(config.database)}` : "/";
  const params: string[] = [];
  if (config.authSource) {
    params.push(`authSource=${encodeURIComponent(config.authSource)}`);
  }
  if (config.tls) {
    params.push("tls=true");
  }
  const query = params.length ? `?${params.join("&")}` : "";
  return `${proto}${auth}${host}:${port}${db}${query}`;
}

async function withClient<T>(
  config: MongoConfig,
  fn: (client: MongoClient) => Promise<T>
): Promise<T> {
  const uri = buildMongoUri(config);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface MongoProbeResult {
  version: string;
  databaseCount: number;
}

export async function probeMongo(config: MongoConfig): Promise<MongoProbeResult> {
  return withClient(config, async (client) => {
    const admin = client.db().admin();
    await admin.ping();
    let version = "unknown";
    try {
      const info = (await admin.serverInfo()) as { version?: string };
      if (info?.version) version = info.version;
    } catch {
      // ignore
    }
    let databaseCount = 0;
    try {
      const dbs = await admin.listDatabases();
      databaseCount = dbs.databases.length;
    } catch {
      // ignore
    }
    return { version, databaseCount };
  });
}

export interface MongoOverview {
  version: string;
  uptimeSeconds: number;
  currentConnections: number;
  availableConnections: number;
  databaseCount: number;
  totalDataSize: number;
  totalStorageSize: number;
  totalCollectionCount: number;
  topDatabasesBySize: { name: string; sizeOnDisk: number; system: boolean }[];
}

export async function getMongoOverview(
  config: MongoConfig
): Promise<MongoOverview> {
  return withClient(config, async (client) => {
    const admin = client.db().admin();

    // serverStatus for version / uptime / connections — some hosted Mongos
    // (Atlas free tier) restrict this; fall back gracefully.
    let version = "unknown";
    let uptimeSeconds = 0;
    let currentConnections = 0;
    let availableConnections = 0;
    try {
      const status = (await admin.serverStatus()) as Document & {
        version?: string;
        uptime?: number;
        connections?: { current?: number; available?: number };
      };
      version = status.version ?? "unknown";
      uptimeSeconds = Math.floor(Number(status.uptime ?? 0));
      currentConnections = Number(status.connections?.current ?? 0);
      availableConnections = Number(status.connections?.available ?? 0);
    } catch {
      // ignore — fall back to serverInfo for version
      try {
        const info = (await admin.serverInfo()) as { version?: string };
        if (info?.version) version = info.version;
      } catch {
        // ignore
      }
    }

    const dbs = await admin.listDatabases();
    let totalDataSize = 0;
    let totalStorageSize = 0;
    const databases: { name: string; sizeOnDisk: number; system: boolean }[] = [];
    for (const d of dbs.databases) {
      const size = Number(d.sizeOnDisk ?? 0);
      totalDataSize += size;
      totalStorageSize += size;
      databases.push({
        name: d.name,
        sizeOnDisk: size,
        system: SYSTEM_DBS.has(d.name),
      });
    }
    const topDatabasesBySize = [...databases]
      .sort((a, b) => b.sizeOnDisk - a.sizeOnDisk)
      .slice(0, 5);

    // Best-effort collection count across all non-system DBs. listCollections
    // is per-db and cheap — but if it fails for a single db, skip it.
    let totalCollectionCount = 0;
    for (const d of dbs.databases) {
      if (SYSTEM_DBS.has(d.name)) continue;
      try {
        const cols = await client.db(d.name).listCollections({}, { nameOnly: true }).toArray();
        totalCollectionCount += cols.length;
      } catch {
        // ignore
      }
    }

    return {
      version,
      uptimeSeconds,
      currentConnections,
      availableConnections,
      databaseCount: dbs.databases.length,
      totalDataSize,
      totalStorageSize,
      totalCollectionCount,
      topDatabasesBySize,
    };
  });
}

export interface MongoDatabaseSummary {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
  collectionCount: number;
  system: boolean;
}

export async function listMongoDatabases(
  config: MongoConfig
): Promise<MongoDatabaseSummary[]> {
  return withClient(config, async (client) => {
    const admin = client.db().admin();
    const dbs = await admin.listDatabases();
    const summaries: MongoDatabaseSummary[] = [];
    for (const d of dbs.databases) {
      const name = d.name;
      let collectionCount = 0;
      try {
        const cols = await client.db(name).listCollections({}, { nameOnly: true }).toArray();
        collectionCount = cols.length;
      } catch {
        // ignore — some system DBs reject listCollections
      }
      summaries.push({
        name,
        sizeOnDisk: Number(d.sizeOnDisk ?? 0),
        empty: Boolean(d.empty),
        collectionCount,
        system: SYSTEM_DBS.has(name),
      });
    }
    return summaries.sort((a, b) => b.sizeOnDisk - a.sizeOnDisk);
  });
}

export interface MongoCollectionSummary {
  name: string;
  type: "collection" | "view" | "timeSeries";
  docCount: number;
  storageBytes: number;
  avgDocSize: number;
  indexCount: number;
}

export interface MongoDatabaseDetail {
  database: {
    name: string;
    sizeBytes: number;
    collectionCount: number;
    indexCount: number;
    docCount: number;
  };
  collections: MongoCollectionSummary[];
}

/**
 * List collections for a database, fanning out `collStats` per collection with
 * bounded concurrency (5) so a database with hundreds of collections doesn't
 * stampede the server.
 */
export async function listMongoCollections(
  config: MongoConfig,
  database: string
): Promise<MongoDatabaseDetail> {
  return withClient(config, async (client) => {
    const db = client.db(database);
    const infos = (await db
      .listCollections({}, { nameOnly: false })
      .toArray()) as Array<{ name: string; type?: string }>;

    const concurrency = 5;
    const results: MongoCollectionSummary[] = new Array(infos.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, infos.length) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= infos.length) return;
        const info = infos[idx];
        const rawType = String(info.type ?? "collection");
        const type: MongoCollectionSummary["type"] =
          rawType === "view"
            ? "view"
            : rawType === "timeseries" || rawType === "timeSeries"
            ? "timeSeries"
            : "collection";
        let docCount = 0;
        let storageBytes = 0;
        let avgDocSize = 0;
        let indexCount = 0;
        try {
          const stats = (await db.command({ collStats: info.name })) as Document & {
            count?: number;
            size?: number;
            storageSize?: number;
            avgObjSize?: number;
            nindexes?: number;
          };
          docCount = Number(stats.count ?? 0);
          storageBytes = Number(stats.storageSize ?? stats.size ?? 0);
          avgDocSize = Number(stats.avgObjSize ?? 0);
          indexCount = Number(stats.nindexes ?? 0);
        } catch {
          // Views and some system collections don't support collStats — try
          // best-effort fallbacks so we still surface a row.
          try {
            const idx = await db.collection(info.name).indexes();
            indexCount = idx.length;
          } catch {
            // ignore
          }
          try {
            docCount = await db.collection(info.name).estimatedDocumentCount();
          } catch {
            // ignore
          }
        }
        results[idx] = {
          name: info.name,
          type,
          docCount,
          storageBytes,
          avgDocSize,
          indexCount,
        };
      }
    });
    await Promise.all(workers);

    const totals = results.reduce(
      (acc, c) => {
        acc.sizeBytes += c.storageBytes;
        acc.indexCount += c.indexCount;
        acc.docCount += c.docCount;
        return acc;
      },
      { sizeBytes: 0, indexCount: 0, docCount: 0 }
    );

    return {
      database: {
        name: database,
        sizeBytes: totals.sizeBytes,
        collectionCount: results.length,
        indexCount: totals.indexCount,
        docCount: totals.docCount,
      },
      collections: results,
    };
  });
}
