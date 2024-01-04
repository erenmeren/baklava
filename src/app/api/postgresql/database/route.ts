import * as postgreSQL from "@/lib/helper/postgreSQL"
import { PostgreSQLConnection } from "@/lib/schemas"
import { NextRequest } from "next/server"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const connectionId = searchParams.get("connectionId")

  if (connectionId) {
    const connection: PostgreSQLConnection | null = await postgreSQL.getConnectionById(
      parseInt(connectionId, 10)
    )

    if (connection) postgreSQL.getDatabaseInfo(connection)

    return Response.json(connection)
  }

  return Response.json({})
}
