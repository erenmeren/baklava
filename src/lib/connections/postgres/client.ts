/**
 * Postgres driver — pooled client access and lightweight probe.
 */
import type { Client as PgClient, Pool as PgPool, PoolClient } from "pg"; // type-only — erased at build, safe when pg absent
import { createHash } from "node:crypto";
import type { PostgresConfig } from "../types";
import { getPg, buildClientConfig } from "./internal";

// ── Connection pooling ───────────────────────────────────────────────────────
// One pg.Pool per (connection identity + database), cached on globalThis so it
// survives Next dev HMR. Replaces the old new-Client-per-call.

interface PgPoolCache {
  byKey: Map<string, PgPool>;
}
const poolCacheKey = Symbol.for("baklava.pgPools");
function poolCache(): PgPoolCache {
  const g = globalThis as unknown as Record<symbol, PgPoolCache>;
  if (!g[poolCacheKey]) g[poolCacheKey] = { byKey: new Map() };
  return g[poolCacheKey];
}

function poolIdentity(config: PostgresConfig): string {
  const pw = createHash("sha256").update(config.password ?? "").digest("hex").slice(0, 16);
  return [config.host, config.port, config.user, config.ssl ? 1 : 0, pw].join(" ");
}
function poolKey(config: PostgresConfig, database: string | undefined): string {
  return `${poolIdentity(config)} ${database || config.database}`;
}

async function getPool(config: PostgresConfig, database: string | undefined): Promise<PgPool> {
  const cache = poolCache();
  const key = poolKey(config, database);
  let pool = cache.byKey.get(key);
  if (!pool) {
    const { Pool } = await getPg();
    pool = new Pool({ ...buildClientConfig(config, database), max: 5, idleTimeoutMillis: 30000 });
    // Idle client errors (server restart / dropped socket) emit 'error' on the
    // pool; unhandled it crashes the process. Log and continue — next acquire reconnects.
    pool.on("error", (err) => console.warn("[baklava] pg pool error:", err.message));
    cache.byKey.set(key, pool);
  }
  return pool;
}

export async function withClient<T>(
  config: PostgresConfig,
  database: string | undefined,
  fn: (client: PgClient) => Promise<T>
): Promise<T> {
  const pool = await getPool(config, database);
  const client: PoolClient = await pool.connect();
  try {
    const result = await fn(client as unknown as PgClient);
    // Reset session state (search_path, SET vars, temp tables, prepared
    // statements) before returning the connection to the pool — otherwise a
    // SET from one borrow leaks into the next. DISCARD ALL also errors if the
    // connection is still inside a transaction, so a caller that returned
    // without committing/rolling back makes the reset throw → we destroy it
    // rather than hand a dirty connection to the next borrower.
    try {
      await client.query("DISCARD ALL");
      client.release();
    } catch {
      client.release(true);
    }
    return result;
  } catch (err) {
    client.release(true); // destroy a possibly mid-transaction/aborted connection
    throw err;
  }
}

/** End and evict every pool for a connection identity (all its databases). */
export function dropPostgresPools(config: PostgresConfig): void {
  const cache = poolCache();
  const prefix = `${poolIdentity(config)} `;
  for (const [key, pool] of cache.byKey) {
    if (key.startsWith(prefix)) {
      cache.byKey.delete(key);
      void pool.end().catch(() => undefined);
    }
  }
}

// ── Test seams ──────────────────────────────────────────────────────────────
export function getPoolForTests(config: PostgresConfig, database: string | undefined) {
  return getPool(config, database);
}
export function _injectPoolForTests(
  config: PostgresConfig,
  database: string | undefined,
  pool: PgPool
): void {
  poolCache().byKey.set(poolKey(config, database), pool);
}
export async function _endAllPostgresPoolsForTests(): Promise<void> {
  const cache = poolCache();
  for (const [key, pool] of cache.byKey) {
    cache.byKey.delete(key);
    await pool.end().catch(() => undefined);
  }
}

export interface PostgresProbe {
  serverVersion: string;
  currentDatabase: string;
  currentUser: string;
}

export async function probePostgres(
  config: PostgresConfig
): Promise<PostgresProbe> {
  return withClient(config, undefined, async (client) => {
    const res = await client.query<{
      version: string;
      current_database: string;
      current_user: string;
    }>(
      "select version() as version, current_database() as current_database, current_user as current_user"
    );
    const row = res.rows[0];
    return {
      serverVersion: row.version,
      currentDatabase: row.current_database,
      currentUser: row.current_user,
    };
  });
}
