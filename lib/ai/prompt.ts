import type { SchemaInfo } from "../sources/types";

/**
 * The schema we hand to the AI for one configured connection.
 * `tableAlias` is the bare identifier the AI must use in SQL — it's how the
 * federated query references this source's table inside DuckDB.
 */
export interface ConnectionSchema {
  /** User-facing connection name (e.g. "pg-local"). */
  connection: string;
  /** Plugin name (e.g. "postgres"). */
  plugin: string;
  /** Schemas of the tables the user can query through this connection. */
  tables: ConnectionTableSchema[];
}

export interface ConnectionTableSchema {
  /** Native table name (e.g. "users"). */
  table: string;
  /** Bare identifier the SQL must reference (e.g. "pg_local__users").
   *  The orchestrator registers this name in DuckDB. */
  tableAlias: string;
  approximate?: boolean;
  approximateNote?: string;
  columns: { name: string; duckdbType: string; nullable: boolean }[];
}

export interface BuildPromptInput {
  nl: string;
  connections: ConnectionSchema[];
  /** Optional: the previous plan's failure reason, fed back to the model on retry. */
  previousFailure?: { sql: string; reason: string };
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

/** Stable alias so the AI references the right DuckDB table. */
export function tableAliasFor(connectionName: string, tableName: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${safe(connectionName)}__${safe(tableName)}`.toLowerCase();
}

const SYSTEM_PROMPT = `You are baklava's federated query planner. Given a developer's question and the schemas of their connected data sources, produce a SQL plan that joins the relevant tables.

Rules — you must follow every one:
1. Output ONLY a single JSON object matching the schema below. No prose, no code fences, no commentary.
2. The SQL must be a single SELECT statement (subqueries and CTEs are fine; UNION/INTERSECT/EXCEPT are fine).
3. Reference only tables and columns that appear in the schemas you were given.
4. Use the tableAlias values verbatim — those are the names DuckDB will see, NOT the original table names.
5. Never use DDL/DML (no INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, ATTACH, INSTALL, LOAD, COPY, PRAGMA, CALL).
6. Never use DuckDB-specific functions like read_json_auto, read_csv, read_parquet — only plain SQL against the declared tables.
7. The "sources" array must list every (connection, table) pair the SQL references.
8. plan_english should be 1-2 plain-English sentences explaining what the SQL does.

Output JSON schema:
{
  "plan_english": "string — 1-2 sentence plain-English summary",
  "sources": [
    { "connection": "string — connection name from the schemas", "table": "string — table name from the schemas" }
  ],
  "sql": "string — the SELECT statement using tableAlias names"
}`;

function formatSchemas(connections: ConnectionSchema[]): string {
  if (connections.length === 0) return "(no connections configured — refuse the query)";
  const out: string[] = [];
  for (const conn of connections) {
    out.push(`Connection "${conn.connection}" (plugin: ${conn.plugin})`);
    if (conn.tables.length === 0) {
      out.push("  (no tables visible)");
      continue;
    }
    for (const t of conn.tables) {
      const noteParts: string[] = [];
      if (t.approximate) noteParts.push("schema is APPROXIMATE (sampled)");
      if (t.approximateNote) noteParts.push(t.approximateNote);
      const note = noteParts.length ? ` -- ${noteParts.join("; ")}` : "";
      out.push(`  Table "${t.table}" → SQL alias: ${t.tableAlias}${note}`);
      for (const col of t.columns) {
        const nul = col.nullable ? "NULL" : "NOT NULL";
        out.push(`    - ${col.name} ${col.duckdbType} ${nul}`);
      }
    }
  }
  return out.join("\n");
}

export function buildPrompt(input: BuildPromptInput): BuiltPrompt {
  const userParts: string[] = [];
  userParts.push(`Question: ${input.nl}`);
  userParts.push("");
  userParts.push("Connected sources:");
  userParts.push(formatSchemas(input.connections));

  if (input.previousFailure) {
    userParts.push("");
    userParts.push("Your previous SQL was rejected by the validator:");
    userParts.push(`  SQL: ${input.previousFailure.sql}`);
    userParts.push(`  Reason: ${input.previousFailure.reason}`);
    userParts.push("Try a different approach.");
  }

  userParts.push("");
  userParts.push("Respond with the JSON plan only.");

  return {
    system: SYSTEM_PROMPT,
    user: userParts.join("\n"),
  };
}
