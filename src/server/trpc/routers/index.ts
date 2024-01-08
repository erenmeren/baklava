import { procedure, router } from "@/server/trpc"
import { postgresqlRouter } from "./postgresql"

export const appRouter = router({
  hello: procedure.query(() => {
    return {
      greeting: `hello world`,
    }
  }),
  postgresql: postgresqlRouter,
})

export type AppRouter = typeof appRouter
