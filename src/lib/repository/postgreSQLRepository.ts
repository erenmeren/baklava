import { PrismaClient } from "@prisma/client"
import { PostgreSQLForm } from "../schemas"

const prisma = new PrismaClient()

export async function save(data: PostgreSQLForm) {
  await prisma.postgreSQL.create({
    data: {
      host: data.host,
      port: data.port,
      database: data.database,
      user: data.user || "",
      password: data.password || "",
    },
  })
}

export async function findAll(): Promise<PostgreSQLForm[]> {
  console.log("girdi")
  return await prisma.postgreSQL.findMany()
}
