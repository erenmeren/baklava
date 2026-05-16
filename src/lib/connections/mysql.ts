import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import type { MysqlConfig } from "./types";

const MYSQL_SYSTEM_DBS = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

export interface MysqlDatabaseSummary {
  name: string;
  sizeBytes: number;
  tableCount: number;
  isSystem: boolean;
}

export interface MysqlOverview {
  version: string;
  hostname: string | null;
  uptimeSeconds: number | null;
  currentUser: string | null;
  charset: string | null;
  collation: string | null;
  databaseCount: number;
  topDatabases: MysqlDatabaseSummary[];
}

export interface MysqlProbeResult {
  version: string;
  databaseCount: number;
}

async function withConnection<T>(
  config: MysqlConfig,
  fn: (conn: Connection) => Promise<T>
): Promise<T> {
  const conn = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database || undefined,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectTimeout: 8000,
  });
  try {
    return await fn(conn);
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export async function probeMysql(config: MysqlConfig): Promise<MysqlProbeResult> {
  return withConnection(config, async (conn) => {
    const [versionRows] = await conn.query<RowDataPacket[]>(
      "SELECT VERSION() AS version"
    );
    const version = (versionRows[0]?.version as string | undefined) ?? "unknown";
    const [dbRows] = await conn.query<RowDataPacket[]>("SHOW DATABASES");
    return { version, databaseCount: dbRows.length };
  });
}

export async function getMysqlOverview(
  config: MysqlConfig
): Promise<MysqlOverview> {
  return withConnection(config, async (conn) => {
    const [versionRows] = await conn.query<RowDataPacket[]>(
      "SELECT VERSION() AS version, @@hostname AS hostname, @@character_set_server AS charset, @@collation_server AS collation, CURRENT_USER() AS user"
    );
    const head = versionRows[0] ?? {};

    let uptimeSeconds: number | null = null;
    try {
      const [uptimeRows] = await conn.query<RowDataPacket[]>(
        "SHOW GLOBAL STATUS LIKE 'Uptime'"
      );
      const raw = uptimeRows[0]?.Value;
      const parsed = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) uptimeSeconds = parsed;
    } catch {
      // Some managed MySQL flavors restrict SHOW GLOBAL STATUS — ignore.
    }

    const [dbStatRows] = await conn.query<RowDataPacket[]>(
      `SELECT
         s.SCHEMA_NAME AS name,
         COALESCE(t.size_bytes, 0) AS size_bytes,
         COALESCE(t.table_count, 0) AS table_count
       FROM information_schema.SCHEMATA s
       LEFT JOIN (
         SELECT
           TABLE_SCHEMA,
           SUM(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) AS size_bytes,
           COUNT(*) AS table_count
         FROM information_schema.TABLES
         GROUP BY TABLE_SCHEMA
       ) t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
       ORDER BY size_bytes DESC`
    );

    const databases: MysqlDatabaseSummary[] = dbStatRows.map((row) => ({
      name: String(row.name),
      sizeBytes: Number(row.size_bytes ?? 0),
      tableCount: Number(row.table_count ?? 0),
      isSystem: MYSQL_SYSTEM_DBS.has(String(row.name).toLowerCase()),
    }));

    return {
      version: String(head.version ?? "unknown"),
      hostname: head.hostname != null ? String(head.hostname) : null,
      uptimeSeconds,
      currentUser: head.user != null ? String(head.user) : null,
      charset: head.charset != null ? String(head.charset) : null,
      collation: head.collation != null ? String(head.collation) : null,
      databaseCount: databases.length,
      topDatabases: databases.slice(0, 5),
    };
  });
}

export async function listMysqlDatabases(
  config: MysqlConfig
): Promise<MysqlDatabaseSummary[]> {
  return withConnection(config, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT
         s.SCHEMA_NAME AS name,
         COALESCE(t.size_bytes, 0) AS size_bytes,
         COALESCE(t.table_count, 0) AS table_count
       FROM information_schema.SCHEMATA s
       LEFT JOIN (
         SELECT
           TABLE_SCHEMA,
           SUM(COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0)) AS size_bytes,
           COUNT(*) AS table_count
         FROM information_schema.TABLES
         GROUP BY TABLE_SCHEMA
       ) t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
       ORDER BY size_bytes DESC`
    );
    return rows.map((row) => ({
      name: String(row.name),
      sizeBytes: Number(row.size_bytes ?? 0),
      tableCount: Number(row.table_count ?? 0),
      isSystem: MYSQL_SYSTEM_DBS.has(String(row.name).toLowerCase()),
    }));
  });
}

export interface MysqlTableSummary {
  name: string;
  engine: string | null;
  rows: number;
  sizeBytes: number;
  collation: string | null;
}

export interface MysqlDatabaseDetail {
  name: string;
  charset: string | null;
  collation: string | null;
  sizeBytes: number;
  tableCount: number;
}

export interface MysqlDatabaseDetailResult {
  database: MysqlDatabaseDetail;
  tables: MysqlTableSummary[];
}

export async function listMysqlTables(
  config: MysqlConfig,
  database: string
): Promise<MysqlDatabaseDetailResult> {
  return withConnection(config, async (conn) => {
    const [schemaRows] = await conn.execute<RowDataPacket[]>(
      `SELECT
         SCHEMA_NAME AS name,
         DEFAULT_CHARACTER_SET_NAME AS charset,
         DEFAULT_COLLATION_NAME AS collation
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME = ?`,
      [database]
    );
    if (schemaRows.length === 0) {
      throw new Error(`Database "${database}" not found`);
    }
    const schema = schemaRows[0];

    const [tableRows] = await conn.execute<RowDataPacket[]>(
      `SELECT
         TABLE_NAME AS name,
         ENGINE AS engine,
         COALESCE(TABLE_ROWS, 0) AS row_count,
         COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS size_bytes,
         TABLE_COLLATION AS collation
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [database]
    );

    const tables: MysqlTableSummary[] = tableRows.map((row) => ({
      name: String(row.name),
      engine: row.engine != null ? String(row.engine) : null,
      rows: Number(row.row_count ?? 0),
      sizeBytes: Number(row.size_bytes ?? 0),
      collation: row.collation != null ? String(row.collation) : null,
    }));

    const totalSize = tables.reduce((acc, t) => acc + t.sizeBytes, 0);

    return {
      database: {
        name: String(schema.name),
        charset: schema.charset != null ? String(schema.charset) : null,
        collation: schema.collation != null ? String(schema.collation) : null,
        sizeBytes: totalSize,
        tableCount: tables.length,
      },
      tables,
    };
  });
}
