import { procedure, router } from "@/server/trpc"
import { TRPCError } from "@trpc/server"

import {
  Column,
  DatabaseSchema,
  PostgreSQLConnection,
  PostgreSQLConnectionSchema,
  QueryResult,
  Table,
} from "@/lib/types"
import { prisma } from "@/server/prisma"
import { Client } from "pg"
import { z } from "zod"

export const postgresqlRouter = router({
  runQuery: procedure
    .input(
      z.object({
        connectionId: z.number(),
        query: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<QueryResult> => {
      const { connectionId, query } = input

      const connection = await getConnectionById(connectionId)

      if (!connection) throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" })

      const client = createClient(connection)

      try {
        await client.connect()

        const result = await client.query(query)

        const fields: string[] = result.fields.map((field) => field.name)
        const rows: any[] = result.rows.map((row) => Object.values(row))

        return { fields, rows }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred"
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: errorMessage })
      } finally {
        await client.end()
      }
    }),

  findAllConnections: procedure.mutation(async (): Promise<PostgreSQLConnection[]> => {
    return prisma.postgreSQL.findMany()
  }),

  saveConnection: procedure
    .input(PostgreSQLConnectionSchema)
    .mutation(async ({ input }): Promise<PostgreSQLConnection> => {
      try {
        return prisma.postgreSQL.create({
          data: {
            host: input.host,
            port: input.port,
            database: input.database,
            user: input.user || "",
            password: input.password || "",
          },
        })
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred"
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: errorMessage })
      }
    }),

  deleteConnectionById: procedure.input(z.number()).mutation(async ({ input }): Promise<number> => {
    await prisma.postgreSQL.delete({ where: { id: input } })
    return input
  }),

  checkConnection: procedure
    .input(PostgreSQLConnectionSchema)
    .mutation(async ({ input }): Promise<void> => {
      const client = createClient(input)

      try {
        await client.connect()
      } catch (error: unknown) {
        const errorMessage =
          "Connection failed: " + (error instanceof Error ? error.message : "Unknown error")
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: errorMessage })
      } finally {
        await client.end()
      }
    }),

  getSchemasByConnectionId: procedure
    .input(z.number())
    .mutation(async ({ input }): Promise<DatabaseSchema[]> => {
      const connection = await getConnectionById(input)

      if (!connection) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Connection not found" })
      }

      const client = createClient(connection)

      try {
        await client.connect()

        const tables = await findAllTables(client)
        const schemas = await findAllSchema(client)
        const columns = await findAllColumns(client)

        tables.forEach((table) => {
          table.columns = columns.filter(
            (column) => column.table === table.name && column.schema === table.schema
          )
        })

        schemas.forEach((schema) => {
          schema.tables = tables
            .filter((table) => table.schema === schema.name)
            .sort((a, b) => a.name.localeCompare(b.name))
        })

        return schemas
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred"
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: errorMessage })
      } finally {
        await client.end()
      }
    }),

  getConnectionById: procedure
    .input(z.number())
    .query(async ({ input }): Promise<PostgreSQLConnection | null> => {
      const id = input
      return prisma.postgreSQL.findUnique({
        where: { id },
      })
    }),
})

function createClient(data: PostgreSQLConnection): Client {
  return new Client({
    user: data.user,
    host: data.host,
    database: data.database,
    password: data.password,
    port: data.port,
  })
}

async function getConnectionById(id: number): Promise<PostgreSQLConnection | null> {
  return await prisma.postgreSQL.findUnique({
    where: {
      id,
    },
  })
}

async function findAllSchema(client: Client): Promise<DatabaseSchema[]> {
  const schemas = await client.query("SELECT schema_name as name FROM information_schema.schemata")
  return schemas.rows
}

async function findAllTables(client: Client): Promise<Table[]> {
  const tables = await client.query(
    "SELECT table_schema as schema, table_name as name, table_type as type FROM information_schema.tables"
  )
  return tables.rows
}

async function findAllColumns(client: Client): Promise<Column[]> {
  const columns = await client.query(`SELECT
                                            c.table_name as table,
                                            c.table_schema as schema,
                                            c.column_name as name,
                                            c.ordinal_position as position,
                                            c.column_default as defaultValue,
                                            c.is_nullable as isNullable,
                                            c.udt_name as udtName,
                                            c.character_maximum_length as characterMaximumLength,
                                            c.numeric_precision as numericPrecision,
                                            c.datetime_precision as datetimePrecision
                                          FROM
                                            information_schema.columns c `)

  /**
   * The column names returned from the database were in lowercase,
   * which caused a mismatch with our TypeScript 'Column' type where the field names start with uppercase letters.
   * To resolve this issue, a transformation map operation was implemented on the results fetched from the database.
   * Each column is now mapped to an object that transforms the raw data from the database into the structure compatible with our 'Column' type.
   * This approach allowed us to achieve the desired data structure without modifying the database query."
   *  */
  return columns.rows.map((column) => ({
    schema: column.schema,
    table: column.table,
    name: column.name,
    position: column.position,
    defaultValue: column.defaultvalue,
    isNullable: column.isnullable,
    udtName: column.udtname,
    characterMaximumLength: column.charactermaximumlength,
    numericPrecision: column.numericprecision,
    datetimePrecision: column.datetimeprecision,
  }))
}
