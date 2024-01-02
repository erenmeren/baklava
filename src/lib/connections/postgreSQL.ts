"use server"

import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import { OperationResult, PostgreSQLForm } from "@/lib/schemas"

const prisma = new PrismaClient()

export async function checkConnection(data: PostgreSQLForm): Promise<OperationResult> {
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

export async function saveConnection(data: PostgreSQLForm): Promise<OperationResult> {
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

export async function getTableNames(data: PostgreSQLForm): Promise<string[]> {
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

function createClient(data: PostgreSQLForm) {
  return new Client({
    user: data.user,
    host: data.host,
    database: data.database,
    password: data.password,
    port: data.port,
  })
}
