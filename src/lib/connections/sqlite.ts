import Database from "better-sqlite3";
import { statSync } from "node:fs";
import type { SqliteConfig } from "./types";

/**
 * Identifier quoter — SQLite identifiers are quoted with double quotes; any
 * embedded `"` must be doubled. We use this to safely build the
 * `SELECT count(*) FROM "<name>"` and `PRAGMA table_info("<name>")` queries.
 */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Strict identifier guard for any path that interpolates user-supplied names
 * into a SQL string (e.g. `PRAGMA` calls — pragmas don't accept bound
 * parameters for the table name, so we have to interpolate). Mirrors the
 * postgres convention in `src/lib/connections/postgres.ts`.
 */
function validateIdentifier(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Table name is required");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error(
      "Table name must start with a letter or underscore and contain only letters, numbers, and underscores"
    );
  }
  return trimmed;
}

function openDb(config: SqliteConfig): Database.Database {
  return new Database(config.filePath, {
    readonly: config.readonly,
    fileMustExist: true,
  });
}

async function withDb<T>(
  config: SqliteConfig,
  fn: (db: Database.Database) => T
): Promise<T> {
  const db = openDb(config);
  try {
    return fn(db);
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

export interface SqliteProbeResult {
  version: string;
  tableCount: number;
}

export async function probeSqlite(
  config: SqliteConfig
): Promise<SqliteProbeResult> {
  return withDb(config, (db) => {
    const versionRow = db.prepare("SELECT sqlite_version() AS v").get() as
      | { v: string }
      | undefined;
    const countRow = db
      .prepare(
        "SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      )
      .get() as { c: number } | undefined;
    return {
      version: versionRow?.v ?? "unknown",
      tableCount: Number(countRow?.c ?? 0),
    };
  });
}

export interface SqliteOverview {
  version: string;
  fileSize: number;
  pageCount: number;
  pageSize: number;
  journalMode: string;
  walAutoCheckpoint: number;
  userTableCount: number;
  systemTableCount: number;
  indexCount: number;
  viewCount: number;
  triggerCount: number;
  encoding: string;
  topTablesBySize: { name: string; rowCount: number; system: boolean }[];
}

function pragmaValue<T = unknown>(
  db: Database.Database,
  pragma: string
): T | undefined {
  try {
    const row = db.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const keys = Object.keys(row);
    if (keys.length === 0) return undefined;
    return row[keys[0]] as T;
  } catch {
    return undefined;
  }
}

export async function getSqliteOverview(
  config: SqliteConfig
): Promise<SqliteOverview> {
  let fileSize = 0;
  try {
    fileSize = statSync(config.filePath).size;
  } catch {
    fileSize = 0;
  }
  return withDb(config, (db) => {
    const version =
      (db.prepare("SELECT sqlite_version() AS v").get() as { v: string } | undefined)?.v ??
      "unknown";
    const pageCount = Number(pragmaValue<number>(db, "page_count") ?? 0);
    const pageSize = Number(pragmaValue<number>(db, "page_size") ?? 0);
    const journalMode = String(pragmaValue<string>(db, "journal_mode") ?? "unknown");
    const walAutoCheckpoint = Number(
      pragmaValue<number>(db, "wal_autocheckpoint") ?? 0
    );
    const encoding = String(pragmaValue<string>(db, "encoding") ?? "utf-8");

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];

    let userTableCount = 0;
    let systemTableCount = 0;
    const perTable: { name: string; rowCount: number; system: boolean }[] = [];
    for (const t of tables) {
      const system = t.name.startsWith("sqlite_");
      if (system) systemTableCount += 1;
      else userTableCount += 1;
      let rowCount = 0;
      try {
        const row = db
          .prepare(`SELECT count(*) AS c FROM ${quoteIdent(t.name)}`)
          .get() as { c: number } | undefined;
        rowCount = Number(row?.c ?? 0);
      } catch {
        rowCount = 0;
      }
      perTable.push({ name: t.name, rowCount, system });
    }
    const topTablesBySize = [...perTable]
      .filter((t) => !t.system)
      .sort((a, b) => b.rowCount - a.rowCount)
      .slice(0, 5);

    const indexCount = Number(
      (
        db
          .prepare(
            "SELECT count(*) AS c FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
          )
          .get() as { c: number } | undefined
      )?.c ?? 0
    );
    const viewCount = Number(
      (
        db
          .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='view'")
          .get() as { c: number } | undefined
      )?.c ?? 0
    );
    const triggerCount = Number(
      (
        db
          .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='trigger'")
          .get() as { c: number } | undefined
      )?.c ?? 0
    );

    return {
      version,
      fileSize,
      pageCount,
      pageSize,
      journalMode,
      walAutoCheckpoint,
      userTableCount,
      systemTableCount,
      indexCount,
      viewCount,
      triggerCount,
      encoding,
      topTablesBySize,
    };
  });
}

export interface SqliteTableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  estimatedBytes: number;
  system: boolean;
}

export async function listSqliteTables(
  config: SqliteConfig
): Promise<SqliteTableSummary[]> {
  return withDb(config, (db) => {
    const pageSize = Number(pragmaValue<number>(db, "page_size") ?? 0);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as { name: string }[];

    const summaries: SqliteTableSummary[] = [];
    for (const t of tables) {
      const system = t.name.startsWith("sqlite_");
      let rowCount = 0;
      try {
        const row = db
          .prepare(`SELECT count(*) AS c FROM ${quoteIdent(t.name)}`)
          .get() as { c: number } | undefined;
        rowCount = Number(row?.c ?? 0);
      } catch {
        rowCount = 0;
      }
      let columnCount = 0;
      try {
        const cols = db
          .prepare(`PRAGMA table_info(${quoteIdent(t.name)})`)
          .all() as unknown[];
        columnCount = cols.length;
      } catch {
        columnCount = 0;
      }
      // Best-effort byte estimate via dbstat virtual table; not always available.
      let estimatedBytes = 0;
      try {
        const row = db
          .prepare(
            "SELECT sum(pgsize) AS s FROM dbstat WHERE name = ?"
          )
          .get(t.name) as { s: number | null } | undefined;
        estimatedBytes = Number(row?.s ?? 0);
      } catch {
        // dbstat not compiled in — fall back to row*pageSize/100 rough guess.
        estimatedBytes = rowCount * Math.max(1, pageSize / 100);
      }
      summaries.push({
        name: t.name,
        rowCount,
        columnCount,
        estimatedBytes,
        system,
      });
    }
    return summaries.sort((a, b) => b.estimatedBytes - a.estimatedBytes);
  });
}

export interface SqliteColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  pk: number;
  defaultValue: string | null;
}

export interface SqliteIndexInfo {
  name: string;
  unique: boolean;
  partial: boolean;
}

export interface SqliteTableDetail {
  table: {
    name: string;
    rowCount: number;
    system: boolean;
    ddl: string;
  };
  columns: SqliteColumnInfo[];
  indexes: SqliteIndexInfo[];
  data: {
    columns: string[];
    rows: unknown[][];
  };
}

/**
 * Full table detail: columns (PRAGMA table_info), indexes (PRAGMA index_list),
 * the original CREATE statement from sqlite_master, the live row count, and a
 * sample of up to 100 rows. `name` is validated against a strict identifier
 * regex BEFORE any string interpolation (pragmas don't accept bound params).
 */
export async function describeSqliteTable(
  config: SqliteConfig,
  name: string
): Promise<SqliteTableDetail> {
  const tableName = validateIdentifier(name);
  return withDb(config, (db) => {
    const ident = quoteIdent(tableName);

    // PRAGMA table_info — { cid, name, type, notnull, dflt_value, pk }
    const rawCols = db
      .prepare(`PRAGMA table_info(${ident})`)
      .all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    const columns: SqliteColumnInfo[] = rawCols.map((c) => ({
      name: c.name,
      type: c.type ?? "",
      notNull: Boolean(c.notnull),
      pk: Number(c.pk ?? 0),
      defaultValue: c.dflt_value,
    }));

    // PRAGMA index_list — { seq, name, unique, origin, partial }
    const rawIdx = db
      .prepare(`PRAGMA index_list(${ident})`)
      .all() as Array<{
      seq: number;
      name: string;
      unique: number;
      origin: string;
      partial: number;
    }>;
    const indexes: SqliteIndexInfo[] = rawIdx.map((i) => ({
      name: i.name,
      unique: Boolean(i.unique),
      partial: Boolean(i.partial),
    }));

    const ddlRow = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?"
      )
      .get(tableName) as { sql: string | null } | undefined;
    const ddl = ddlRow?.sql ?? "";

    let rowCount = 0;
    try {
      const r = db
        .prepare(`SELECT count(*) AS c FROM ${ident}`)
        .get() as { c: number } | undefined;
      rowCount = Number(r?.c ?? 0);
    } catch {
      rowCount = 0;
    }

    let dataCols: string[] = columns.map((c) => c.name);
    let dataRows: unknown[][] = [];
    try {
      const stmt = db.prepare(`SELECT * FROM ${ident} LIMIT 100`);
      const rows = stmt.all() as Record<string, unknown>[];
      if (rows.length > 0 && dataCols.length === 0) {
        dataCols = Object.keys(rows[0]);
      }
      dataRows = rows.map((r) => dataCols.map((c) => r[c]));
    } catch {
      dataRows = [];
    }

    return {
      table: {
        name: tableName,
        rowCount,
        system: tableName.startsWith("sqlite_"),
        ddl,
      },
      columns,
      indexes,
      data: {
        columns: dataCols,
        rows: dataRows,
      },
    };
  });
}
