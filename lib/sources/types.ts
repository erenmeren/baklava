/**
 * The Plugin interface every source connector implements.
 *
 * Stays deliberately small for v0.1: list tables, sample schema, fetch rows,
 * health-check. Streaming watch + mutate are reserved for later phases but
 * declared here so the interface doesn't break when they land.
 */

export interface ConnectionConfig {
  /** User-facing name (e.g. "pg-local"). Stable identifier in connections.json. */
  name: string;
  /** Plugin name (e.g. "postgres", "sqlite"). */
  plugin: string;
  /** Plugin-specific fields — validated by the plugin's validateConfig. */
  config: Record<string, unknown>;
}

export interface ColumnInfo {
  name: string;
  /** Native type as the source describes it (e.g. "INTEGER", "varchar(255)", "timestamptz"). */
  nativeType: string;
  /** Mapped DuckDB type for federation (e.g. "INTEGER", "VARCHAR", "TIMESTAMP"). */
  duckdbType: string;
  nullable: boolean;
}

export interface SchemaInfo {
  table: string;
  columns: ColumnInfo[];
  /** True when the schema was sampled (Mongo-style). False when declared (Postgres). */
  approximate?: boolean;
  approximateNote?: string;
}

export type FilterClause =
  | { op: "eq" | "neq"; column: string; value: string | number | boolean | null }
  | { op: "in" | "nin"; column: string; values: (string | number)[] }
  | { op: "gt" | "gte" | "lt" | "lte"; column: string; value: number | string }
  | { op: "and" | "or"; clauses: FilterClause[] };

export interface FetchSpec {
  table: string;
  /** null/undefined = all columns from the schema. */
  columns?: string[];
  /** Structured filter the plugin compiles to its native query language. */
  where?: FilterClause;
  /** Per-source hard ceiling. Default 1000; UI may raise to 100000. */
  limit?: number;
}

export interface HealthStatus {
  ok: boolean;
  latencyMs: number;
  message?: string;
}

/** A connected, ready-to-query handle. Plugins decide what this contains
 *  (a pg Pool, a SQLite Database, a fetch client). The host treats it as opaque. */
export type PluginHandle = unknown;

export interface Plugin<H = PluginHandle> {
  readonly name: string;

  /** Throw a BaklavaException if config is invalid. Pure validation, no I/O. */
  validateConfig(c: ConnectionConfig): void;

  /** Establish a connection and return a handle owned by the plugin. */
  connect(c: ConnectionConfig): Promise<H>;

  /** Quick liveness probe for the "Test Connection" button. <1s target. */
  health(handle: H): Promise<HealthStatus>;

  /** Tables/collections/topics/etc. the user can query. */
  listTables(handle: H): Promise<SchemaInfo[]>;

  /** Stream rows for a given fetch spec. Caller pulls via `for await`. */
  fetchRows(handle: H, spec: FetchSpec): AsyncIterable<Record<string, unknown>>;

  /** Release the connection (close pool, disconnect client). */
  disconnect(handle: H): Promise<void>;
}

/**
 * Plugin SDK version string. Plugins shipped externally pin against this so
 * a baklava upgrade with a breaking SDK change can refuse incompatible ones.
 */
export const SDK_VERSION = "0.1.0";

/** Default per-source row ceiling. */
export const DEFAULT_LIMIT = 1000;
/** Hard ceiling the UI must not exceed. */
export const MAX_LIMIT = 100_000;

export function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIMIT);
}
