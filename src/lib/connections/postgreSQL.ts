"use server"

import { Client } from "pg"
import { ConnectionResult, PostgreSQLForm } from "@/lib/schemas"

export async function checkConnection(data: PostgreSQLForm): Promise<ConnectionResult> {
  let message = "Connected successfully!"
  let isSuccessful = true
  const client = createClient(data)

  console.log(client)

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
