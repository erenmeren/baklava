import { router } from "@/server/trpc"
import { postgresqlRouter } from "./postgreSql"
import { dockerRouter } from "./docker"

export const appRouter = router({
  postgresql: postgresqlRouter,
  docker: dockerRouter,
})

export type AppRouter = typeof appRouter
