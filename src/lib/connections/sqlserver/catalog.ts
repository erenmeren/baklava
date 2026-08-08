/**
 * SQL Server driver — read-only catalog introspection (databases, schemas,
 * tables, columns, indexes, constraints, foreign keys, modules, dependencies).
 */
import type { SqlServerConfig } from "../types";
import { withPool, getMssql, fetchDatabaseStats } from "./internal";
import { SQLSERVER_DB_NAME_RE, validateSqlServerIdentifier } from "./sql";

export interface SqlServerDatabaseSummary {
  name: string;
  sizeBytes: number;
  tableCount: number;
  isSystem: boolean;
  state: string;
}

export async function listSqlServerDatabases(
  config: SqlServerConfig
): Promise<SqlServerDatabaseSummary[]> {
  return withPool(config, (pool) => fetchDatabaseStats(pool));
}

export interface SqlServerTableSummary {
  name: string;
  schema: string;
  rows: number;
  sizeBytes: number;
}

export interface SqlServerDatabaseDetail {
  name: string;
  state: string;
  recoveryModel: string | null;
  compatibilityLevel: number | null;
  collation: string | null;
  sizeBytes: number;
  tableCount: number;
}

export interface SqlServerDatabaseDetailResult {
  database: SqlServerDatabaseDetail;
  tables: SqlServerTableSummary[];
}

/**
 * List user schemas in a database (dbo + custom), excluding the built-in
 * system schemas and the nine fixed database-role schemas. Used by the sidebar
 * tree so empty / freshly-created schemas show up (object listing alone would
 * only surface schemas that already contain something).
 */
export async function listSqlServerSchemas(
  config: SqlServerConfig,
  database: string
): Promise<string[]> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      const res = await pool.request().query<{ name: string }>(`
        SELECT name FROM sys.schemas
        WHERE name NOT IN (
          'guest','sys','INFORMATION_SCHEMA',
          'db_owner','db_accessadmin','db_securityadmin','db_ddladmin',
          'db_backupoperator','db_datareader','db_datawriter',
          'db_denydatareader','db_denydatawriter'
        )
        ORDER BY name
      `);
      return res.recordset.map((r) => String(r.name));
    },
    { database }
  );
}

/**
 * Bulk-list every table/view in a schema with their columns. Used to feed the
 * SQL editor's autocomplete in one round-trip instead of N per-table calls.
 * Schema is parameterized (not spliced) so we don't need the identifier
 * whitelist here — the value never reaches the SQL text.
 */
export async function listSqlServerSchemaColumns(
  config: SqlServerConfig,
  database: string,
  schema: string,
): Promise<Array<{ name: string; columns: string[] }>> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      const res = await pool
        .request()
        .input(
          "schema",
          ((await getMssql()).default as unknown as { NVarChar: unknown }).NVarChar,
          schema,
        )
        .query<{ table_name: string; column_name: string }>(`
          SELECT o.name AS table_name, c.name AS column_name
          FROM sys.objects o
          JOIN sys.columns c ON c.object_id = o.object_id
          WHERE SCHEMA_NAME(o.schema_id) = @schema
            AND o.type IN ('U','V')
          ORDER BY o.name, c.column_id
        `);
      const map = new Map<string, string[]>();
      for (const row of res.recordset) {
        const arr = map.get(row.table_name) ?? [];
        arr.push(row.column_name);
        map.set(row.table_name, arr);
      }
      return [...map.entries()].map(([name, columns]) => ({ name, columns }));
    },
    { database },
  );
}

export async function listSqlServerTables(
  config: SqlServerConfig,
  database: string
): Promise<SqlServerDatabaseDetailResult> {
  if (!SQLSERVER_DB_NAME_RE.test(database)) {
    throw new Error(
      "Invalid database name (only letters, digits, and underscores are supported)"
    );
  }

  return withPool(config, async (pool) => {
    // Per-DB metadata is read from sys.databases on the server connection.
    // `sql.NVarChar` is attached at runtime via the dynamic types loop in
    // mssql/lib/base/index.js but mssql ships no .d.ts, so cast through any.
    const headResult = await pool
      .request()
      .input("db", ((await getMssql()).default as unknown as { NVarChar: unknown }).NVarChar, database)
      .query<{
        name: string;
        state_desc: string;
        recovery_model_desc: string;
        compatibility_level: number;
        collation_name: string | null;
        size_bytes: string | number | null;
      }>(`
        SELECT
          d.name AS name,
          d.state_desc AS state_desc,
          d.recovery_model_desc AS recovery_model_desc,
          d.compatibility_level AS compatibility_level,
          d.collation_name AS collation_name,
          (
            SELECT SUM(CAST(size AS BIGINT) * 8192)
            FROM sys.master_files mf
            WHERE mf.database_id = d.database_id
          ) AS size_bytes
        FROM sys.databases d
        WHERE d.name = @db
      `);
    if (headResult.recordset.length === 0) {
      throw new Error(`Database "${database}" not found`);
    }
    const head = headResult.recordset[0];

    // Per-table rows + reserved size. sys.tables / sys.schemas / sys.partitions
    // / sys.allocation_units are per-database, so we switch context with
    // `USE [dbname]`. The name has already been validated against
    // SQLSERVER_DB_NAME_RE above.
    const tablesResult = await pool.request().query<{
      schema_name: string;
      table_name: string;
      row_count: string | number;
      reserved_bytes: string | number | null;
    }>(`
      USE [${database}];
      SELECT
        s.name AS schema_name,
        t.name AS table_name,
        SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END) AS row_count,
        SUM(CAST(a.total_pages AS BIGINT)) * 8192 AS reserved_bytes
      FROM sys.tables t
      INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
      LEFT JOIN sys.partitions p ON p.object_id = t.object_id
      LEFT JOIN sys.allocation_units a ON a.container_id = p.partition_id
      WHERE t.is_ms_shipped = 0
      GROUP BY s.name, t.name
      ORDER BY s.name, t.name;
    `);

    const tables: SqlServerTableSummary[] = tablesResult.recordset.map(
      (row) => ({
        schema: String(row.schema_name),
        name: String(row.table_name),
        rows: Number(row.row_count ?? 0),
        sizeBytes: Number(row.reserved_bytes ?? 0),
      })
    );

    return {
      database: {
        name: String(head.name),
        state: String(head.state_desc ?? "UNKNOWN"),
        recoveryModel: head.recovery_model_desc
          ? String(head.recovery_model_desc)
          : null,
        compatibilityLevel:
          head.compatibility_level != null
            ? Number(head.compatibility_level)
            : null,
        collation: head.collation_name ? String(head.collation_name) : null,
        sizeBytes: Number(head.size_bytes ?? 0),
        tableCount: tables.length,
      },
      tables,
    };
  });
}

export interface SqlServerObject {
  schema: string;
  name: string;
  /** table | view | proc | scalar_fn | table_fn | trigger | synonym | sequence | type | table_type */
  kind: string;
  type: string; // raw sys.objects type code, trimmed
}

export async function listSqlServerObjects(
  config: SqlServerConfig,
  database: string,
): Promise<SqlServerObject[]> {
  validateSqlServerIdentifier(database, "database name");
  return withPool(
    config,
    async (pool) => {
      const res = await pool.request().query<{
        schema_name: string;
        name: string;
        type: string;
      }>(`
        SELECT s.name AS schema_name, o.name AS name, RTRIM(o.type) AS type
        FROM sys.objects o
        JOIN sys.schemas s ON s.schema_id = o.schema_id
        WHERE o.is_ms_shipped = 0
          AND o.type IN ('U','V','P','FN','IF','TF','TR','SN','SO','TT')
        UNION ALL
        SELECT s.name AS schema_name, sy.name AS name, 'SN' AS type
        FROM sys.synonyms sy
        JOIN sys.schemas s ON s.schema_id = sy.schema_id
        UNION ALL
        SELECT s.name AS schema_name, t.name AS name, 'UDT' AS type
        FROM sys.types t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE t.is_user_defined = 1 AND t.is_table_type = 0
        ORDER BY schema_name, name
      `);
      const kindOf = (t: string): string => {
        switch (t) {
          case "U": return "table";
          case "V": return "view";
          case "P": return "proc";
          case "FN": return "scalar_fn";
          case "IF":
          case "TF": return "table_fn";
          case "TR": return "trigger";
          case "SN": return "synonym";
          case "SO": return "sequence";
          case "TT": return "table_type";
          case "UDT": return "type";
          default: return t;
        }
      };
      // De-dup synonyms (the UNION can double them if also in sys.objects).
      const seen = new Set<string>();
      const out: SqlServerObject[] = [];
      for (const r of res.recordset) {
        const key = `${r.schema_name}.${r.name}.${r.type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          schema: String(r.schema_name),
          name: String(r.name),
          kind: kindOf(String(r.type)),
          type: String(r.type),
        });
      }
      return out;
    },
    { database },
  );
}

export interface SqlServerColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isIdentity: boolean;
  identitySeed: string | null;
  identityIncrement: string | null;
  isComputed: boolean;
  computedDefinition: string | null;
  isPrimaryKey: boolean;
  defaultDefinition: string | null;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
}

export interface SqlServerIndex {
  name: string;
  typeDesc: string; // CLUSTERED / NONCLUSTERED / HEAP / CLUSTERED COLUMNSTORE…
  isPrimaryKey: boolean;
  isUnique: boolean;
  keyColumns: string[];
  includedColumns: string[];
  sizeBytes: number;
  userSeeks: number;
  userScans: number;
  userLookups: number;
  userUpdates: number;
  unused: boolean;
}

export interface SqlServerConstraintRow {
  name: string;
  type: string; // CHECK / DEFAULT / PRIMARY KEY / UNIQUE
  definition: string;
}

export interface SqlServerForeignKeyRow {
  name: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onUpdate: string;
  onDelete: string;
}

export interface SqlServerTableDetail {
  schema: string;
  table: string;
  isHeap: boolean;
  rowCount: number;
  columns: SqlServerColumn[];
  indexes: SqlServerIndex[];
  constraints: SqlServerConstraintRow[];
  foreignKeys: SqlServerForeignKeyRow[];
}

export async function getSqlServerTableDetail(
  config: SqlServerConfig,
  database: string,
  schema: string,
  table: string,
): Promise<SqlServerTableDetail> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(table, "table name");
  return withPool(
    config,
    async (pool) => {
      const objId = `OBJECT_ID('${schema}.${table}')`;

      const colsP = pool.request().query<{
        name: string;
        type_name: string;
        is_nullable: boolean;
        is_identity: boolean;
        seed_value: string | null;
        increment_value: string | null;
        is_computed: boolean;
        computed_def: string | null;
        max_length: number;
        precision: number;
        scale: number;
        is_pk: number;
        default_def: string | null;
      }>(`
        SELECT
          c.name AS name,
          TYPE_NAME(c.user_type_id) AS type_name,
          c.is_nullable, c.is_identity, c.is_computed,
          ic.seed_value, ic.increment_value,
          cc.definition AS computed_def,
          c.max_length, c.precision, c.scale,
          CASE WHEN EXISTS (
            SELECT 1 FROM sys.index_columns kc
            JOIN sys.indexes i ON i.object_id = kc.object_id AND i.index_id = kc.index_id
            WHERE kc.object_id = c.object_id AND kc.column_id = c.column_id AND i.is_primary_key = 1
          ) THEN 1 ELSE 0 END AS is_pk,
          dc.definition AS default_def
        FROM sys.columns c
        LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
        LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
        WHERE c.object_id = ${objId}
        ORDER BY c.column_id
      `);

      const idxP = pool.request().query<{
        index_id: number;
        name: string | null;
        type_desc: string;
        is_primary_key: boolean;
        is_unique: boolean;
        key_cols: string | null;
        incl_cols: string | null;
        size_bytes: string | number | null;
        user_seeks: number | null;
        user_scans: number | null;
        user_lookups: number | null;
        user_updates: number | null;
      }>(`
        SELECT
          i.index_id, i.name, i.type_desc, i.is_primary_key, i.is_unique,
          (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal)
             FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
             WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0) AS key_cols,
          (SELECT STRING_AGG(c.name, ', ')
             FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
             WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1) AS incl_cols,
          (SELECT SUM(a.used_pages) * 8192 FROM sys.partitions p
             JOIN sys.allocation_units a ON a.container_id = p.partition_id
             WHERE p.object_id = i.object_id AND p.index_id = i.index_id) AS size_bytes,
          us.user_seeks, us.user_scans, us.user_lookups, us.user_updates
        FROM sys.indexes i
        LEFT JOIN sys.dm_db_index_usage_stats us
          ON us.object_id = i.object_id AND us.index_id = i.index_id AND us.database_id = DB_ID()
        WHERE i.object_id = ${objId}
        ORDER BY i.is_primary_key DESC, i.index_id
      `);

      const consP = pool.request().query<{
        name: string;
        type: string;
        definition: string;
      }>(`
        SELECT name, 'CHECK' AS type, definition FROM sys.check_constraints WHERE parent_object_id = ${objId}
        UNION ALL
        SELECT dc.name, 'DEFAULT' AS type, dc.definition FROM sys.default_constraints dc WHERE dc.parent_object_id = ${objId}
      `);

      const fkP = pool.request().query<{
        name: string;
        cols: string;
        ref_schema: string;
        ref_table: string;
        ref_cols: string;
        update_action: string;
        delete_action: string;
      }>(`
        SELECT
          fk.name,
          (SELECT STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id)
             FROM sys.foreign_key_columns fkc JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
             WHERE fkc.constraint_object_id = fk.object_id) AS cols,
          rs.name AS ref_schema, rt.name AS ref_table,
          (SELECT STRING_AGG(rc.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id)
             FROM sys.foreign_key_columns fkc JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
             WHERE fkc.constraint_object_id = fk.object_id) AS ref_cols,
          fk.update_referential_action_desc AS update_action,
          fk.delete_referential_action_desc AS delete_action
        FROM sys.foreign_keys fk
        JOIN sys.tables rt ON rt.object_id = fk.referenced_object_id
        JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
        WHERE fk.parent_object_id = ${objId}
      `);

      const rowsP = pool.request().query<{ row_count: string | number }>(`
        SELECT SUM(CASE WHEN p.index_id IN (0,1) THEN p.rows ELSE 0 END) AS row_count
        FROM sys.partitions p WHERE p.object_id = ${objId}
      `);

      const [cols, idx, cons, fk, rowsR] = await Promise.all([colsP, idxP, consP, fkP, rowsP]);

      const columns: SqlServerColumn[] = cols.recordset.map((c) => ({
        name: String(c.name),
        dataType: String(c.type_name),
        nullable: Boolean(c.is_nullable),
        isIdentity: Boolean(c.is_identity),
        identitySeed: c.seed_value != null ? String(c.seed_value) : null,
        identityIncrement: c.increment_value != null ? String(c.increment_value) : null,
        isComputed: Boolean(c.is_computed),
        computedDefinition: c.computed_def ?? null,
        isPrimaryKey: Number(c.is_pk) === 1,
        defaultDefinition: c.default_def ?? null,
        maxLength: c.max_length != null ? Number(c.max_length) : null,
        precision: c.precision != null ? Number(c.precision) : null,
        scale: c.scale != null ? Number(c.scale) : null,
      }));

      const indexes: SqlServerIndex[] = idx.recordset
        .filter((i) => i.name != null || i.type_desc === "HEAP")
        .map((i) => {
          const seeks = Number(i.user_seeks ?? 0);
          const scans = Number(i.user_scans ?? 0);
          const lookups = Number(i.user_lookups ?? 0);
          const updates = Number(i.user_updates ?? 0);
          return {
            name: i.name ? String(i.name) : "(heap)",
            typeDesc: String(i.type_desc),
            isPrimaryKey: Boolean(i.is_primary_key),
            isUnique: Boolean(i.is_unique),
            keyColumns: i.key_cols ? String(i.key_cols).split(", ") : [],
            includedColumns: i.incl_cols ? String(i.incl_cols).split(", ") : [],
            sizeBytes: Number(i.size_bytes ?? 0),
            userSeeks: seeks,
            userScans: scans,
            userLookups: lookups,
            userUpdates: updates,
            unused: !i.is_primary_key && !i.is_unique && seeks + scans + lookups === 0 && updates > 0,
          };
        });

      const isHeap = indexes.some((i) => i.typeDesc === "HEAP");

      return {
        schema,
        table,
        isHeap,
        rowCount: Number(rowsR.recordset[0]?.row_count ?? 0),
        columns,
        indexes,
        constraints: cons.recordset.map((c) => ({
          name: String(c.name),
          type: String(c.type),
          definition: String(c.definition),
        })),
        foreignKeys: fk.recordset.map((f) => ({
          name: String(f.name),
          columns: f.cols ? String(f.cols).split(", ") : [],
          refSchema: String(f.ref_schema),
          refTable: String(f.ref_table),
          refColumns: f.ref_cols ? String(f.ref_cols).split(", ") : [],
          onUpdate: String(f.update_action),
          onDelete: String(f.delete_action),
        })),
      };
    },
    { database },
  );
}

/** Reconstruct a CREATE TABLE script from catalog metadata (no SMO dependency). */
export function buildSqlServerTableDDL(detail: SqlServerTableDetail): string {
  const colLines = detail.columns.map((c) => {
    const parts = [`  [${c.name}]`];
    if (c.isComputed && c.computedDefinition) {
      parts.push(`AS ${c.computedDefinition}`);
    } else {
      parts.push(c.dataType);
      if (c.isIdentity) {
        parts.push(`IDENTITY(${c.identitySeed ?? 1},${c.identityIncrement ?? 1})`);
      }
      parts.push(c.nullable ? "NULL" : "NOT NULL");
      if (c.defaultDefinition) parts.push(`DEFAULT ${c.defaultDefinition}`);
    }
    return parts.join(" ");
  });

  const pkCols = detail.columns.filter((c) => c.isPrimaryKey).map((c) => `[${c.name}]`);
  const lines = [...colLines];
  if (pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.join(", ")})`);
  }

  const create = `CREATE TABLE [${detail.schema}].[${detail.table}] (\n${lines.join(",\n")}\n);`;

  const indexDdl = detail.indexes
    .filter((i) => !i.isPrimaryKey && i.name !== "(heap)" && i.keyColumns.length > 0)
    .map((i) => {
      const unique = i.isUnique ? "UNIQUE " : "";
      const clustered = i.typeDesc.includes("CLUSTERED") && !i.typeDesc.includes("NONCLUSTERED") ? "CLUSTERED " : "NONCLUSTERED ";
      const incl = i.includedColumns.length > 0 ? ` INCLUDE (${i.includedColumns.map((c) => `[${c}]`).join(", ")})` : "";
      return `CREATE ${unique}${clustered}INDEX [${i.name}] ON [${detail.schema}].[${detail.table}] (${i.keyColumns.map((c) => `[${c}]`).join(", ")})${incl};`;
    });

  const fkDdl = detail.foreignKeys.map(
    (f) =>
      `ALTER TABLE [${detail.schema}].[${detail.table}] ADD CONSTRAINT [${f.name}] FOREIGN KEY (${f.columns.map((c) => `[${c}]`).join(", ")}) REFERENCES [${f.refSchema}].[${f.refTable}] (${f.refColumns.map((c) => `[${c}]`).join(", ")});`,
  );

  return [create, ...indexDdl, ...fkDdl].join("\n\n");
}

// ─── Modules (procs/functions) ────────────────────────────────────────────

export interface SqlServerParam {
  name: string;
  type: string;
  isOutput: boolean;
  hasDefault: boolean;
}

export interface SqlServerModule {
  schema: string;
  name: string;
  kind: string;
  definition: string | null;
  params: SqlServerParam[];
}

export async function getSqlServerModule(
  config: SqlServerConfig,
  database: string,
  schema: string,
  name: string,
): Promise<SqlServerModule> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(name, "object name");
  return withPool(
    config,
    async (pool) => {
      const objId = `OBJECT_ID('${schema}.${name}')`;
      const [defR, parR, kindR] = await Promise.all([
        pool.request().query<{ definition: string | null }>(
          `SELECT OBJECT_DEFINITION(${objId}) AS definition`,
        ),
        pool.request().query<{
          name: string;
          type_name: string;
          is_output: boolean;
          has_default_value: boolean;
        }>(`
          SELECT p.name, TYPE_NAME(p.user_type_id) AS type_name,
                 p.is_output, p.has_default_value
          FROM sys.parameters p
          WHERE p.object_id = ${objId}
          ORDER BY p.parameter_id
        `),
        pool.request().query<{ type: string }>(
          `SELECT RTRIM(type) AS type FROM sys.objects WHERE object_id = ${objId}`,
        ),
      ]);
      const typeCode = kindR.recordset[0]?.type ?? "P";
      const kind =
        typeCode === "P" ? "proc"
        : typeCode === "FN" ? "scalar_fn"
        : typeCode === "IF" || typeCode === "TF" ? "table_fn"
        : typeCode === "TR" ? "trigger"
        : typeCode === "V" ? "view"
        : typeCode;
      return {
        schema,
        name,
        kind,
        definition: defR.recordset[0]?.definition ?? null,
        params: parR.recordset.map((p) => ({
          name: String(p.name),
          type: String(p.type_name),
          isOutput: Boolean(p.is_output),
          hasDefault: Boolean(p.has_default_value),
        })),
      };
    },
    { database },
  );
}

// ─── Dependencies ──────────────────────────────────────────────────────────

export interface SqlServerDependency {
  schema: string | null;
  name: string;
  type: string | null;
}

export async function getSqlServerDependencies(
  config: SqlServerConfig,
  database: string,
  schema: string,
  object: string,
): Promise<{ referencing: SqlServerDependency[]; referenced: SqlServerDependency[] }> {
  validateSqlServerIdentifier(database, "database name");
  validateSqlServerIdentifier(schema, "schema name");
  validateSqlServerIdentifier(object, "object name");
  return withPool(
    config,
    async (pool) => {
      const target = `'${schema}.${object}'`;
      const refrR = await pool
        .request()
        .query<{ schema_name: string | null; name: string; type: string | null }>(`
          SELECT referencing_schema_name AS schema_name, referencing_entity_name AS name,
                 o.type_desc AS type
          FROM sys.dm_sql_referencing_entities(${target}, 'OBJECT') re
          LEFT JOIN sys.objects o ON o.object_id = re.referencing_id
        `)
        .catch(() => null);
      const refdR = await pool
        .request()
        .query<{ schema_name: string | null; name: string | null; type: string | null }>(`
          SELECT referenced_schema_name AS schema_name, referenced_entity_name AS name, NULL AS type
          FROM sys.dm_sql_referenced_entities(${target}, 'OBJECT')
        `)
        .catch(() => null);
      const map = (
        rows: Array<{ schema_name: string | null; name: string | null; type?: string | null }> | undefined,
      ): SqlServerDependency[] =>
        (rows ?? [])
          .filter((r) => r.name)
          .map((r) => ({
            schema: r.schema_name ?? null,
            name: String(r.name),
            type: r.type ?? null,
          }));
      // De-dup referenced entities (one row per column otherwise).
      const refdSeen = new Set<string>();
      const referenced = map(refdR?.recordset).filter((d) => {
        const k = `${d.schema}.${d.name}`;
        if (refdSeen.has(k)) return false;
        refdSeen.add(k);
        return true;
      });
      return { referencing: map(refrR?.recordset), referenced };
    },
    { database },
  );
}
