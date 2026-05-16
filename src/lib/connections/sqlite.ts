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
