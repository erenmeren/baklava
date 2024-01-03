import { PostgreSQLForm } from "@/lib/schemas"
import * as postgreSQLRepository from "@/lib/repository/postgreSQLRepository"

// export async function GET(request: Request): Promise<PostgreSQLForm[]> {
export async function GET(request: Request) {
  const data = await postgreSQLRepository.findAll()

  return Response.json(data)
}
