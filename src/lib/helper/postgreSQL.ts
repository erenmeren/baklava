import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import {
  Column,
  DatabaseSchema,
  OperationResult,
  PostgreSQLConnection,
  Table,
  QueryResult,
} from "@/lib/schemas"

const prisma = new PrismaClient()

function createClient(data: PostgreSQLConnection): Client {
  return new Client({
    user: data.user,
    host: data.host,
    database: data.database,
    password: data.password,
    port: data.port,
  })
}

export async function checkConnection(data: PostgreSQLConnection): Promise<OperationResult> {
  let message = "Connected successfully!"
  let isSuccessful = true
  const client = createClient(data)

  try {
    await client.connect()
  } catch (err: any) {
    isSuccessful = false
    message = "Connection failed: " + err.message
  } finally {
    await client.end()
  }

  return { message, isSuccessful }
}

export async function findAllConnections(): Promise<PostgreSQLConnection[]> {
  return await prisma.postgreSQL.findMany()
}

export async function saveConnection(data: PostgreSQLConnection): Promise<OperationResult> {
  const message = "Saved successfully!"
  const isSuccessful = true

  await prisma.postgreSQL.create({
    data: {
      host: data.host,
      port: data.port,
      database: data.database,
      user: data.user || "",
      password: data.password || "",
    },
  })

  return { message, isSuccessful }
}

export async function getConnectionById(id: number): Promise<PostgreSQLConnection | null> {
  return await prisma.postgreSQL.findUnique({
    where: {
      id,
    },
  })
}

export async function getDatabaseInfoByConnectionId(
  connectionId: number
): Promise<OperationResult<DatabaseSchema[]>> {
  const connection: PostgreSQLConnection | null = await getConnectionById(connectionId)

  if (!connection) return { message: "Connection not found!", isSuccessful: false }
  const client = createClient(connection)

  try {
    await client.connect()

    const tables: Table[] = await findAllTables(client)
    const schemas: DatabaseSchema[] = await findAllSchema(client)
    const columns: Column[] = await findAllClomuns(client)

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

    return { isSuccessful: true, data: schemas }
  } catch (err: any) {
    return { isSuccessful: false, message: err.message }
  } finally {
    await client.end()
  }
}

export async function getTableNames(client: Client): Promise<string[]> {
  const tables = await client.query(
    "SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public'"
  )
  return tables.rows.map((table) => table.name)
}

export async function findAllSchema(client: Client): Promise<DatabaseSchema[]> {
  const schemas = await client.query("SELECT schema_name as name FROM information_schema.schemata")
  return schemas.rows
}

export async function findAllTables(client: Client): Promise<Table[]> {
  const tables = await client.query(
    "SELECT table_schema as schema, table_name as name, table_type as type FROM information_schema.tables"
  )
  return tables.rows
}

export async function findAllClomuns(client: Client): Promise<Column[]> {
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

export async function runQuery(
  connectionId: number,
  query: string
): Promise<OperationResult<QueryResult>> {
  const connection: PostgreSQLConnection | null = await getConnectionById(connectionId)

  if (!connection) return { message: "Connection not found!", isSuccessful: false }
  const client = createClient(connection)

  try {
    await client.connect()
    const result = await client.query(query)

    const fields: string[] = result.fields.map((field) => field.name)
    const rows: any[] = result.rows.map((row) => Object.values(row))

    return { isSuccessful: true, data: { fields, rows } }
  } catch (err: any) {
    return { isSuccessful: false, message: err.message }
  } finally {
    await client.end()
  }
}
