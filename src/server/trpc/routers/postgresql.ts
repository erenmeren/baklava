import { PostgreSQLConnection } from "@/lib/types"
import { prisma } from "@/server/prisma"
import { procedure, router } from "@/server/trpc"

export const postgresqlRouter = router({
  getConnections: procedure.query(async (): Promise<PostgreSQLConnection[]> => {
    return await prisma.postgreSQL.findMany()
  }),
})
