/**
 * Postgres driver — cross-module private helpers.
 *
 * Exported from here so multiple sibling modules can share them, but NOT
 * re-exported from the barrel (postgres.ts) — these were never part of the
 * driver's public surface and must stay invisible outside ./postgres/*.
 */
import type { ClientConfig } from "pg"; // type-only — erased at build, safe when pg absent
import { DriverNotInstalledError } from "@/techs/contract";
import type { PostgresConfig } from "../types";
import { quoteIdent } from "./sql";

let pgMod: typeof import("pg") | null = null;
export async function getPg(): Promise<typeof import("pg")> {
  try {
    return (pgMod ??= await import("pg"));
  } catch {
    throw new DriverNotInstalledError("postgres", "pg");
  }
}

let pgCursorMod: typeof import("pg-cursor") | null = null;
export async function getPgCursor(): Promise<typeof import("pg-cursor").default> {
  try {
    return (pgCursorMod ??= await import("pg-cursor")).default;
  } catch {
    throw new DriverNotInstalledError("postgres", "pg-cursor");
  }
}

export function buildClientConfig(
  config: PostgresConfig,
  databaseOverride?: string,
  opts?: { statementTimeoutMs?: number }
): ClientConfig {
  return {
    host: config.host,
    port: config.port,
    database: databaseOverride || config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 6000,
    // 0 = no limit (used for backup / restore, which can run long).
    statement_timeout: opts?.statementTimeoutMs ?? 15000,
  };
}

export function tableIdent(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}
