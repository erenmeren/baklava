import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import { OperationResult, PostgreSQLConnection } from "@/lib/schemas"

const prisma = new PrismaClient()

function createClient(data: PostgreSQLConnection) {
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

export async function getDatabaseInfo(data: PostgreSQLConnection) {}

export async function getTableNames(data: PostgreSQLConnection): Promise<string[]> {
  const client = createClient(data)
  try {
    const res = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    )
    console.log("Tablolar:", res.rows)
    return res.rows.map((row) => row.table_name)
  } catch (err: any) {
    console.error(err)
    return []
  } finally {
    client.end()
  }
}

// export async function findAllSchema() {
//   const schemas = await prisma.$queryRaw`SELECT schema_name FROM information_schema.schemata`
//   console.log(schemas)
// }

// export async function findAllTables() {
//   const schemas =
//     await prisma.$queryRaw`SELECT table_schema, table_name, table_type FROM information_schema.tables`
//   console.log(schemas)
// }

// export async function findAllClomuns() {
//   const schemas = await prisma.$queryRaw`SELECT
//                                             c.table_name,
//                                             c.table_schema,
//                                             c.column_name,
//                                             c.ordinal_position,
//                                             c.column_default,
//                                             c.is_nullable,
//                                             c.udt_name,
//                                             c.character_maximum_length,
//                                             c.numeric_precision,
//                                             c.datetime_precision
//                                           FROM
//                                             information_schema.columns c`
//   console.log(schemas)
// }
