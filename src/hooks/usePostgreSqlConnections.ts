import { useEffect } from "react"
import { trpc } from "@/utils/trpc"
import usePostgreSqlStore from "@/store/postgreSql"

export const usePostgreSqlConnections = () => {
  const { connections, setConnections } = usePostgreSqlStore()

  const { data, isLoading } = trpc.postgresql.findAllConnections.useQuery(undefined, {
    enabled: !connections.length,
  })

  useEffect(() => {
    if (data && data.length > 0 && !connections.length) {
      setConnections(data)
    }
  }, [data, connections, setConnections])

  return { connections, isLoading }
}
