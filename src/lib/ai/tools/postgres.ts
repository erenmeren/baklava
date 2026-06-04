import { z } from "zod";
import type { PostgresConfig } from "@/lib/connections/types";
import {
  listDatabases,
  listAllRelations,
  listColumns,
  getTableDDL,
  runReadOnlyQuery,
  createTable,
  dropTable,
  type CreateTableColumnInput,
} from "@/lib/connections/postgres";
import type { AiTool } from "./types";

const READ_SQL_MAX_ROWS = 1000;

export function pgTools(_connectionId: string, config: PostgresConfig): AiTool[] {
  return [
    {
      name: "pg_list_databases",
      description: "List databases on this PostgreSQL server.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listDatabases(config),
    },
    {
      name: "pg_list_tables",
      description: "List tables/views in a database with their columns.",
      category: "read",
      inputSchema: z.object({ database: z.string() }),
      execute: async ({ database }) =>
        (await listAllRelations(config, database as string)).filter((r) => !r.isSystem),
    },
    {
      name: "pg_describe_table",
      description: "Get a table's columns and its CREATE TABLE DDL.",
      category: "read",
      inputSchema: z.object({ database: z.string(), schema: z.string(), table: z.string() }),
      execute: async ({ database, schema, table }) => ({
        columns: await listColumns(config, database as string, schema as string, table as string),
        ddl: await getTableDDL(config, database as string, schema as string, table as string),
      }),
    },
    {
      name: "pg_run_sql",
      description:
        "Run a READ-ONLY SQL query (SELECT / analytics) and return rows. Writes are rejected by the database. Use this for calculations and data exploration.",
      category: "read",
      inputSchema: z.object({ database: z.string(), sql: z.string() }),
      execute: async ({ database, sql }) =>
        runReadOnlyQuery(config, database as string, sql as string, READ_SQL_MAX_ROWS),
    },
    {
      name: "pg_create_table",
      description: "Create a new table with the given columns.",
      category: "write",
      inputSchema: z.object({
        database: z.string(),
        schema: z.string().default("public"),
        name: z.string(),
        columns: z
          .array(
            z.object({
              name: z.string(),
              dataType: z.string(),
              nullable: z.boolean().default(true),
              isPrimaryKey: z.boolean().default(false),
              default: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ database, schema, name, columns }) => {
        await createTable(config, database as string, {
          schema: schema as string,
          name: name as string,
          columns: columns as CreateTableColumnInput[],
        });
        return { ok: true, created: `${schema}.${name}` };
      },
    },
    {
      name: "pg_drop_table",
      description: "Drop (delete) a table. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({
        database: z.string(),
        schema: z.string().default("public"),
        table: z.string(),
        cascade: z.boolean().default(false),
      }),
      execute: async ({ database, schema, table, cascade }) => {
        await dropTable(config, database as string, schema as string, table as string, {
          cascade: (cascade as boolean) ?? false,
        });
        return { ok: true, dropped: `${schema}.${table}` };
      },
    },
  ];
}
