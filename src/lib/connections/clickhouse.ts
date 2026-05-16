import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { ClickhouseConfig } from "./types";

export function createCh(config: ClickhouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.user || "default",
    password: config.password ?? "",
    database: config.database || "default",
    request_timeout: 5000,
  });
}

async function queryRows<T>(
  client: ClickHouseClient,
  query: string
): Promise<T[]> {
  const rs = await client.query({ query, format: "JSONEachRow" });
  return (await rs.json()) as T[];
}

export interface ClickhouseProbeResult {
  version: string;
}

export async function probeClickhouse(
  config: ClickhouseConfig
): Promise<ClickhouseProbeResult> {
  const client = createCh(config);
  try {
    const rows = await queryRows<{ "version()"?: string; version?: string }>(
      client,
      "SELECT version() AS version"
    );
    const v = rows[0]?.version ?? rows[0]?.["version()"] ?? "";
    return { version: String(v) };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ClickhouseTopTable {
  name: string;
  rows: number;
  bytes: number;
}

export interface ClickhouseOverview {
  version: string;
  uptimeSeconds: number;
  database: string;
  tableCount: number;
  totalRows: number;
  totalBytes: number;
  runningQueries: number;
  topTablesByRows: ClickhouseTopTable[];
}

export async function getOverview(
  config: ClickhouseConfig
): Promise<ClickhouseOverview> {
  const client = createCh(config);
  try {
    const meta = await queryRows<{
      version: string;
      uptime: number;
      db: string;
    }>(
      client,
      "SELECT version() AS version, toUInt64(uptime()) AS uptime, currentDatabase() AS db"
    );
    const stats = await queryRows<{
      tables: number;
      rows: number;
      bytes: number;
    }>(
      client,
      `SELECT
         toUInt64(count()) AS tables,
         toUInt64(sum(total_rows)) AS rows,
         toUInt64(sum(total_bytes)) AS bytes
       FROM system.tables
       WHERE database = currentDatabase()
         AND engine NOT IN ('View','MaterializedView','LiveView','WindowView')`
    );
    const procs = await queryRows<{ n: number }>(
      client,
      "SELECT toUInt64(count()) AS n FROM system.processes"
    );
    const topRows = await queryRows<{
      name: string;
      rows: number;
      bytes: number;
    }>(
      client,
      `SELECT
         name,
         toUInt64(total_rows) AS rows,
         toUInt64(total_bytes) AS bytes
       FROM system.tables
       WHERE database = currentDatabase()
         AND engine NOT IN ('View','MaterializedView','LiveView','WindowView')
       ORDER BY total_rows DESC NULLS LAST
       LIMIT 5`
    );

    return {
      version: meta[0]?.version ?? "",
      uptimeSeconds: Number(meta[0]?.uptime ?? 0) || 0,
      database: meta[0]?.db ?? config.database,
      tableCount: Number(stats[0]?.tables ?? 0) || 0,
      totalRows: Number(stats[0]?.rows ?? 0) || 0,
      totalBytes: Number(stats[0]?.bytes ?? 0) || 0,
      runningQueries: Number(procs[0]?.n ?? 0) || 0,
      topTablesByRows: topRows.map((t) => ({
        name: t.name,
        rows: Number(t.rows ?? 0) || 0,
        bytes: Number(t.bytes ?? 0) || 0,
      })),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ClickhouseTableSummary {
  name: string;
  engine: string;
  rows: number;
  bytes: number;
  modifiedAt: string | null;
}

export async function listTables(
  config: ClickhouseConfig
): Promise<ClickhouseTableSummary[]> {
  const client = createCh(config);
  try {
    const rows = await queryRows<{
      name: string;
      engine: string;
      total_rows: number | string | null;
      total_bytes: number | string | null;
      metadata_modification_time: string | null;
    }>(
      client,
      `SELECT
         name,
         engine,
         total_rows,
         total_bytes,
         toString(metadata_modification_time) AS metadata_modification_time
       FROM system.tables
       WHERE database = currentDatabase()
       ORDER BY name`
    );
    return rows.map((r) => ({
      name: r.name,
      engine: r.engine,
      rows: Number(r.total_rows ?? 0) || 0,
      bytes: Number(r.total_bytes ?? 0) || 0,
      modifiedAt: r.metadata_modification_time ?? null,
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}
