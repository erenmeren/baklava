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
