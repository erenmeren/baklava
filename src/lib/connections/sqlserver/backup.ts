/**
 * SQL Server driver — backup history and native BACKUP DATABASE.
 */
import type { SqlServerConfig } from "../types";
import { withPool, getMssql } from "./internal";
import { validateSqlServerIdentifier } from "./sql";

export interface BackupHistoryRow {
  type: string; // Full / Differential / Log
  startTime: string | null;
  finishTime: string | null;
  sizeBytes: number;
  device: string | null;
}

export async function getSqlServerBackupHistory(
  config: SqlServerConfig,
  database: string,
): Promise<BackupHistoryRow[]> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(config, async (pool) => {
    const res = await pool
      .request()
      .input("db", ((await getMssql()).default as unknown as { NVarChar: unknown }).NVarChar, database)
      .query<{
        type: string;
        backup_start_date: Date | null;
        backup_finish_date: Date | null;
        backup_size: string | number | null;
        physical_device_name: string | null;
      }>(`
        SELECT TOP 50
          CASE bs.type WHEN 'D' THEN 'Full' WHEN 'I' THEN 'Differential'
               WHEN 'L' THEN 'Log' ELSE bs.type END AS type,
          bs.backup_start_date, bs.backup_finish_date, bs.backup_size,
          bmf.physical_device_name
        FROM msdb.dbo.backupset bs
        LEFT JOIN msdb.dbo.backupmediafamily bmf ON bmf.media_set_id = bs.media_set_id
        WHERE bs.database_name = @db
        ORDER BY bs.backup_start_date DESC
      `);
    return res.recordset.map((r) => ({
      type: String(r.type),
      startTime: r.backup_start_date ? new Date(r.backup_start_date).toISOString() : null,
      finishTime: r.backup_finish_date ? new Date(r.backup_finish_date).toISOString() : null,
      sizeBytes: Number(r.backup_size ?? 0),
      device: r.physical_device_name ?? null,
    }));
  });
}

/**
 * Native BACKUP DATABASE to a server-side path (the SQL Server service
 * account writes it, NOT the Baklava host). Path is validated to a
 * conservative charset since it's spliced into the statement.
 */
export async function backupSqlServerDatabase(
  config: SqlServerConfig,
  database: string,
  path: string,
): Promise<void> {
  validateSqlServerIdentifier(database, "database name");
  // Allow typical Windows/Linux path chars; reject quotes/semicolons.
  if (!/^[A-Za-z0-9_\-./\\: ]+$/.test(path) || path.includes("'")) {
    throw new Error("Invalid backup path");
  }
  await withPool(
    config,
    async (pool) => {
      await pool
        .request()
        .batch(
          `BACKUP DATABASE [${database}] TO DISK = N'${path}' WITH COMPRESSION, CHECKSUM, INIT, STATS = 10`,
        );
    },
    { requestTimeoutMs: 600_000 },
  );
}
