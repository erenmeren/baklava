import { z } from "zod";
import type { SqlServerConfig } from "@/lib/connections/types";
import {
  listSqlServerDatabases,
  listSqlServerObjects,
  getSqlServerTableDetail,
  runReadOnlyQuery,
  createSqlServerTable,
  dropSqlServerObject,
  type CreateSqlServerColumnInput,
} from "@/lib/connections/sqlserver";
import type { AiTool } from "./types";

const READ_SQL_MAX_ROWS = 1000;

export function mssqlTools(_connectionId: string, config: SqlServerConfig): AiTool[] {
  return [
    {
      name: "mssql_list_databases",
      description: "List databases on this SQL Server instance.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listSqlServerDatabases(config),
    },
    {
      name: "mssql_list_objects",
      description: "List tables, views, procedures and functions in a database.",
      category: "read",
      inputSchema: z.object({ database: z.string() }),
      execute: async ({ database }) => listSqlServerObjects(config, database as string),
    },
    {
      name: "mssql_describe_table",
      description: "Get a table's columns, indexes, constraints and foreign keys.",
      category: "read",
      inputSchema: z.object({ database: z.string(), schema: z.string().default("dbo"), table: z.string() }),
      execute: async ({ database, schema, table }) =>
        getSqlServerTableDetail(config, database as string, ((schema as string) ?? "dbo") || "dbo", table as string),
    },
    {
      name: "mssql_run_sql",
      description:
        "Run a READ-ONLY SQL query (SELECT / analytics) and return rows. Writes are rejected and rolled back. Use this for calculations and data exploration.",
      category: "read",
      inputSchema: z.object({ database: z.string(), sql: z.string() }),
      execute: async ({ database, sql }) =>
        runReadOnlyQuery(config, database as string, sql as string, READ_SQL_MAX_ROWS),
    },
    {
      name: "mssql_create_table",
      description: "Create a new table with the given columns.",
      category: "write",
      inputSchema: z.object({
        database: z.string(),
        schema: z.string().default("dbo"),
        name: z.string(),
        columns: z
          .array(
            z.object({
              name: z.string(),
              dataType: z.string(),
              nullable: z.boolean().default(true),
              isPrimaryKey: z.boolean().default(false),
              identity: z.boolean().default(false),
              default: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ database, schema, name, columns }) => {
        await createSqlServerTable(config, database as string, {
          schema: ((schema as string) ?? "dbo") || "dbo",
          name: name as string,
          columns: columns as CreateSqlServerColumnInput[],
        });
        return { ok: true, created: `${schema ?? "dbo"}.${name}` };
      },
    },
    {
      name: "mssql_drop_object",
      description: "Drop (delete) a table, view, procedure or function. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({
        database: z.string(),
        schema: z.string().default("dbo"),
        name: z.string(),
        kind: z.enum(["table", "view", "proc", "scalar_fn", "table_fn", "trigger", "synonym", "sequence", "type"]).default("table"),
      }),
      execute: async ({ database, schema, name, kind }) => {
        await dropSqlServerObject(config, database as string, {
          schema: ((schema as string) ?? "dbo") || "dbo",
          name: name as string,
          kind: (kind as string) ?? "table",
        });
        return { ok: true, dropped: `${schema ?? "dbo"}.${name}` };
      },
    },
  ];
}
