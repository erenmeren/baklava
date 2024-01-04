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
