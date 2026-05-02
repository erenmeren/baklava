import { Database } from "duckdb";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BAKLAVA_DIR } from "./config";
import { BaklavaException, makeError } from "./errors";

const TEMP_DIR = join(BAKLAVA_DIR, "duck-tmp");
const DEFAULT_MEMORY_LIMIT = process.env.BAKLAVA_DUCK_MEMORY_LIMIT ?? "4GB";

export type DuckDB = Database;

export interface RunOptions {
  memoryLimit?: string;
  tempDir?: string;
}

function ensureTempDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function runSql(db: Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function closeDb(db: Database): Promise<void> {
  return new Promise((resolve) => {
    try {
      db.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

export function allRows<Row = Record<string, unknown>>(
  db: Database,
  sql: string
): Promise<Row[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as Row[]);
    });
  });
}

/**
 * Open a fresh in-memory DuckDB instance, run `fn` against it, then close.
 *
 * Per-query isolation closes three risks at once:
 *   - phantom-table attack from an earlier query's residual registration
 *   - concurrent-request race on a shared appender
 *   - unbounded memory growth across queries
 *
 * Open cost is ~10ms; acceptable for v0.1 throughput.
 */
export async function withDuck<T>(
  fn: (db: Database) => Promise<T>,
  opts: RunOptions = {}
): Promise<T> {
  const tempDir = opts.tempDir ?? TEMP_DIR;
  const memoryLimit = opts.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
  ensureTempDir(tempDir);

  const db = new Database(":memory:");
  try {
    await runSql(db, `PRAGMA temp_directory='${tempDir.replace(/'/g, "''")}'`);
    await runSql(db, `PRAGMA memory_limit='${memoryLimit.replace(/'/g, "''")}'`);
    return await fn(db);
  } catch (err) {
    if (isOom(err)) {
      throw new BaklavaException(
        makeError({
          code: "E_DUCKDB_OOM",
          what: "DuckDB ran out of memory while executing the query.",
          why: `The combined fetched-and-joined result exceeded the configured limit of ${memoryLimit}.`,
          fix: "Lower the per-source row limit (LIMIT slider in the UI), or set BAKLAVA_DUCK_MEMORY_LIMIT to a higher value if your machine has more RAM.",
          raw: { error: String(err) },
        })
      );
    }
    throw err;
  } finally {
    await closeDb(db);
  }
}

function isOom(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = (err as { message?: unknown }).message;
  return typeof msg === "string" && /memory|out of memory|memory_limit/i.test(msg);
}
