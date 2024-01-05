import * as postgreSQL from "@/lib/helper/postgreSQL"
import { PostgreSQLConnection } from "@/lib/schemas"
import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const connectionId = searchParams.get("connectionId")

  if (connectionId) {
    const info = await postgreSQL.getDatabaseInfoByConnectionId(parseInt(connectionId, 10))
    return Response.json(info)
  }

  return Response.json({})
}

export async function POST(request: NextRequest) {
  let result: any

  const { query } = await request.json()

  const searchParams = request.nextUrl.searchParams
  const connectionId = searchParams.get("connectionId")

  if (connectionId) result = await postgreSQL.runQuery(parseInt(connectionId, 10), query)

  return Response.json(result)
}
