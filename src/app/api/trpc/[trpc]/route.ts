import { appRouter } from "@/server/trpc/routers"
import { fetchRequestHandler } from "@trpc/server/adapters/fetch"

const handler = (request: Request) => {
  // console.log(`incoming request ${request.url}`)
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => ({}),
  })
}

export { handler as GET, handler as POST }
