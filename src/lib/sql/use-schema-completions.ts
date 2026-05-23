"use client";

import { useEffect, useState } from "react";

type Tech = "postgres" | "sqlserver";

const DEFAULT_SCHEMA: Record<Tech, string> = {
  postgres: "public",
  sqlserver: "dbo",
};

export interface SchemaCompletions {
  /** Resolved schema name (the picked schema, or the dialect default). */
  schemaName: string;
  /** table → columns. Fed to @codemirror/lang-sql `schema` option. */
  tables: Record<string, string[]>;
}

/**
 * Fetch the (db, schema) tables-and-columns digest used to drive the SQL
 * editor's autocomplete. Refetches when db or schema changes. Returns `null`
 * while loading or on error so the editor can fall back to keyword-only
 * completion gracefully.
 */
export function useSchemaCompletions(args: {
  tech: Tech;
  connectionId: string;
  db: string;
  /** User-picked schema (null = use dialect default). */
  schema: string | null;
}): SchemaCompletions | null {
  const { tech, connectionId, db, schema } = args;
  const effective = schema ?? DEFAULT_SCHEMA[tech];
  const [data, setData] = useState<SchemaCompletions | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(
      `/api/${tech}/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(effective)}/columns`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((d: { tables?: Array<{ name: string; columns: string[] }> }) => {
        if (cancelled) return;
        const tables: Record<string, string[]> = {};
        for (const t of d.tables ?? []) tables[t.name] = t.columns;
        setData({ schemaName: effective, tables });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tech, connectionId, db, effective]);

  return data;
}
