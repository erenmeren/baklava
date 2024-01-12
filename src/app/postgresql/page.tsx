"use client"

import { DatabaseSchema, QueryResult } from "@/lib/types"
import { memo, useCallback, useEffect, useMemo, useState } from "react"

import { toast } from "sonner"

import Menu from "@/components/postgreSQLMenu"
import { format } from "sql-formatter"
import { trpc } from "@/utils/trpc"
import { useQueryClient } from "@tanstack/react-query"
import DatabaseEditor from "@/components/editor/db/editor"

const DB_NAME = "postgresql"
const MemorizedMenu = memo(Menu)

export default function PostgreSQLHome() {
  const [queryResult, setQueryResult] = useState<QueryResult>()
  const [query, setQuery] = useState<string>("")
  const [connectionId, setConnectionId] = useState<number>(0)
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseSchema[]>([])
  const [openCommand, setOpenCommand] = useState(false)

  const queryClient = useQueryClient()

  let {
    data: connections,
    isLoading: isConnectionsLoading,
    isFetching: isConnectionsFetching,
  } = trpc.postgresql.findAllConnections.useQuery()

  trpc.postgresql.getDatabaseInfoByConnectionId.useQuery(connectionId, {
    onSuccess: (data) => {
      setDatabaseInfo(data)
    },
    onError: (error) => {
      setConnectionId(0)
      toast.error(error.message)
    },
    enabled: connectionId > 0,
    retry: false,
  })

  const { mutate: _runQuery } = trpc.postgresql.runQuery.useMutation({
    onSuccess: (result) => {
      setQueryResult(result)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  useEffect(() => {
    if (connectionId > 0) {
      queryClient.invalidateQueries(["getDatabaseInfoByConnectionId", connectionId])
    }
  }, [connectionId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpenCommand((open) => !open)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault()
        runQuery()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault()
        formatQuery()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [query, connectionId])

  const getDatabaseInfo = useCallback(async (connId: number) => {
    setDatabaseInfo([])

    if (!connId || connId < 1) {
      toast.error("Something worng!")
      return
    }

    setConnectionId(connId)
  }, [])

  const memoizedMenuProps = useMemo(
    () => ({
      connections: connections || [],
      getDatabaseInfo,
      databaseInfo,
    }),
    [connections, getDatabaseInfo, databaseInfo]
  )

  async function runQuery() {
    if (!connectionId) return toast.error("Choose a connection!")
    if (query === "") return toast.error("Query is empty!")

    _runQuery({ connectionId, query })
  }

  function formatQuery() {
    setQuery(
      format(query, {
        language: DB_NAME,
        tabWidth: 2,
        keywordCase: "upper",
        linesBetweenQueries: 2,
      })
    )
  }

  const refreshMenu = async () => {
    queryClient.refetchQueries([
      [DB_NAME, "findAllConnections"],
      {
        type: "query",
      },
    ])
  }

  return (
    <DatabaseEditor
      openCommand={openCommand}
      setOpenCommand={setOpenCommand}
      query={query}
      setQuery={setQuery}
      queryResult={queryResult}
      runQuery={runQuery}
      formatQuery={formatQuery}
      refreshMenu={refreshMenu}
      isLoading={isConnectionsLoading}
      isFetching={isConnectionsFetching}
      memoizedMenuProps={memoizedMenuProps}
      MemorizedMenu={MemorizedMenu}
    />
  )
}
