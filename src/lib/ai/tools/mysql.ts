import { z } from "zod";
import type { MysqlConfig } from "@/lib/connections/types";
import {
  listDatabases,
  listTables,
  listColumns,
  getTableDDL,
  runReadOnlyQuery,
  createTable,
  dropTable,
  type CreateTableColumnInput,
} from "@/lib/connections/mysql";
import type { AiTool } from "./types";

const READ_SQL_MAX_ROWS = 1000;

export function mysqlTools(_connectionId: string, config: MysqlConfig): AiTool[] {
  return [
    {
      name: "mysql_list_databases",
      description: "List databases on this MySQL server.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listDatabases(config),
    },
    {
      name: "mysql_list_tables",
      description: "List tables and views in a database.",
      category: "read",
      inputSchema: z.object({ database: z.string() }),
      execute: async ({ database }) => listTables(config, database as string),
    },
    {
      name: "mysql_describe_table",
      description: "Get a table's columns and its CREATE TABLE DDL.",
      category: "read",
      inputSchema: z.object({ database: z.string(), table: z.string() }),
      execute: async ({ database, table }) => ({
        columns: await listColumns(config, database as string, table as string),
        ddl: await getTableDDL(config, database as string, table as string),
      }),
    },
    {
      name: "mysql_run_sql",
      description:
        "Run a READ-ONLY SQL query (SELECT / analytics) and return rows. Writes are rejected by the database. Use this for calculations and data exploration.",
      category: "read",
      inputSchema: z.object({ database: z.string(), sql: z.string() }),
      execute: async ({ database, sql }) =>
        runReadOnlyQuery(config, database as string, sql as string, READ_SQL_MAX_ROWS),
    },
    {
      name: "mysql_create_table",
      description: "Create a new table with the given columns.",
      category: "write",
      inputSchema: z.object({
        database: z.string(),
        name: z.string(),
        columns: z
          .array(
            z.object({
              name: z.string(),
              type: z.string(),
              nullable: z.boolean().default(true),
              primaryKey: z.boolean().default(false),
              autoIncrement: z.boolean().default(false),
              default: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ database, name, columns }) => {
        await createTable(config, database as string, {
          name: name as string,
          columns: columns as CreateTableColumnInput[],
        });
        return { ok: true, created: `${database}.${name}` };
      },
    },
    {
      name: "mysql_drop_table",
      description: "Drop (delete) a table. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({ database: z.string(), table: z.string() }),
      execute: async ({ database, table }) => {
        await dropTable(config, database as string, table as string);
        return { ok: true, dropped: `${database}.${table}` };
      },
    },
  ];
}
