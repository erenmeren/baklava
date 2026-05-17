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
  query: string,
  queryParams?: Record<string, unknown>
): Promise<T[]> {
  const rs = await client.query({
    query,
    format: "JSONEachRow",
    query_params: queryParams,
  });
  return (await rs.json()) as T[];
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** @internal — exported for tests. */
export function requireSafeIdentifier(name: string, kind: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid ${kind} name: ${name}`);
  }
  return name;
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

// ─────────────────────────────────────────────────────────────────────────────
// Table detail
// ─────────────────────────────────────────────────────────────────────────────

export interface ClickhouseColumn {
  name: string;
  type: string;
  defaultExpression: string;
  codecExpression: string;
  comment: string;
}

export interface ClickhouseTableHeader {
  name: string;
  engine: string;
  rows: number;
  bytes: number;
  modifiedAt: string | null;
  ddl: string;
}

export interface ClickhouseTableDetail {
  table: ClickhouseTableHeader;
  columns: ClickhouseColumn[];
}

export async function getClickhouseTable(
  config: ClickhouseConfig,
  name: string
): Promise<ClickhouseTableDetail> {
  const client = createCh(config);
  try {
    const cols = await queryRows<{
      name: string;
      type: string;
      default_expression: string;
      codec_expression: string;
      comment: string;
    }>(
      client,
      `SELECT name, type, default_expression, codec_expression, comment
       FROM system.columns
       WHERE database = currentDatabase() AND table = {name:String}
       ORDER BY position`,
      { name }
    );

    const ddlRows = await queryRows<{ create_table_query: string }>(
      client,
      `SELECT create_table_query
       FROM system.tables
       WHERE database = currentDatabase() AND name = {name:String}`,
      { name }
    );

    const statRows = await queryRows<{
      engine: string;
      total_rows: number | string | null;
      total_bytes: number | string | null;
      metadata_modification_time: string | null;
    }>(
      client,
      `SELECT
         engine,
         total_rows,
         total_bytes,
         toString(metadata_modification_time) AS metadata_modification_time
       FROM system.tables
       WHERE database = currentDatabase() AND name = {name:String}`,
      { name }
    );

    if (statRows.length === 0) {
      throw new Error(`Table ${name} not found`);
    }
    const stat = statRows[0];

    return {
      table: {
        name,
        engine: stat.engine,
        rows: Number(stat.total_rows ?? 0) || 0,
        bytes: Number(stat.total_bytes ?? 0) || 0,
        modifiedAt: stat.metadata_modification_time ?? null,
        ddl: ddlRows[0]?.create_table_query ?? "",
      },
      columns: cols.map((c) => ({
        name: c.name,
        type: c.type,
        defaultExpression: c.default_expression ?? "",
        codecExpression: c.codec_expression ?? "",
        comment: c.comment ?? "",
      })),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ClickhouseSampleResult {
  columns: string[];
  rows: unknown[][];
}

export async function sampleClickhouseTable(
  config: ClickhouseConfig,
  name: string,
  limit = 100
): Promise<ClickhouseSampleResult> {
  // Defense-in-depth: {tbl:Identifier} is the protected path, but reject
  // anything that could otherwise sneak through.
  requireSafeIdentifier(name, "table");
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit) || 100));
  const client = createCh(config);
  try {
    const rs = await client.query({
      query: `SELECT * FROM {tbl:Identifier} LIMIT {lim:UInt32}`,
      format: "JSON",
      query_params: { tbl: name, lim: safeLimit },
    });
    const payload = (await rs.json()) as {
      meta?: { name: string }[];
      data?: Record<string, unknown>[];
    };
    const columns = (payload.meta ?? []).map((m) => m.name);
    const rows = (payload.data ?? []).map((row) =>
      columns.map((c) => row[c])
    );
    return { columns, rows };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface ClickhousePartitionRow {
  partition: string;
  partsCount: number;
  rows: number;
  bytesOnDisk: number;
  modifiedAt: string | null;
}

export async function getClickhousePartitions(
  config: ClickhouseConfig,
  name: string
): Promise<ClickhousePartitionRow[]> {
  const client = createCh(config);
  try {
    const rows = await queryRows<{
      partition: string;
      parts_count: number | string;
      rows: number | string;
      bytes_on_disk: number | string;
      modified_at: string | null;
    }>(
      client,
      `SELECT
         partition,
         toUInt64(count()) AS parts_count,
         toUInt64(sum(rows)) AS rows,
         toUInt64(sum(bytes_on_disk)) AS bytes_on_disk,
         toString(max(modification_time)) AS modified_at
       FROM system.parts
       WHERE database = currentDatabase()
         AND table = {name:String}
         AND active
       GROUP BY partition
       ORDER BY partition DESC`,
      { name }
    );
    return rows.map((r) => ({
      partition: r.partition,
      partsCount: Number(r.parts_count ?? 0) || 0,
      rows: Number(r.rows ?? 0) || 0,
      bytesOnDisk: Number(r.bytes_on_disk ?? 0) || 0,
      modifiedAt: r.modified_at || null,
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function truncateClickhouseTable(
  config: ClickhouseConfig,
  name: string
): Promise<void> {
  requireSafeIdentifier(name, "table");
  const client = createCh(config);
  try {
    await client.command({
      query: `TRUNCATE TABLE {tbl:Identifier}`,
      query_params: { tbl: name },
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function dropClickhouseTable(
  config: ClickhouseConfig,
  name: string
): Promise<void> {
  requireSafeIdentifier(name, "table");
  const client = createCh(config);
  try {
    await client.command({
      query: `DROP TABLE {tbl:Identifier}`,
      query_params: { tbl: name },
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}
