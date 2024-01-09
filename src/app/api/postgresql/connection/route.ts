import * as postgreSQL from "@/lib/helper/postgreSQL"
import { OperationResult, PostgreSQLConnection } from "@/lib/types"
import { NextRequest } from "next/server"

export async function GET(request: Request) {
  const data = await postgreSQL.findAllConnections()

  return Response.json(data)
}

export async function POST(request: NextRequest) {
  let result: OperationResult
  const connection: PostgreSQLConnection = await request.json()
  const searchParams = request.nextUrl.searchParams
  const isConnectionCheck = searchParams.get("connectionCheck")

  if (isConnectionCheck) {
    result = await postgreSQL.checkConnection(connection)
  } else {
    result = await postgreSQL.saveConnection(connection)
  }

  return Response.json(result)
}
