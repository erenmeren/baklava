"use client"

import { DatabaseSchema, OperationResult, QueryResult } from "@/lib/schemas"
import { memo, useCallback, useMemo, useState } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import Menu from "@/components/postgreSQLMenu"
import SkeletonOfMenu from "@/components/postgreSQLMenu.skeleton"
import { Icons } from "@/components/icons"
import PostreSQLForm from "@/components/forms/postgreSQLForm"
import Link from "next/link"
import { format } from "sql-formatter"
import { trpc } from "@/utils/trpc"
import { useQueryClient } from "@tanstack/react-query"

const DB_NAME = "postgresql"
const MemorizedMenu = memo(Menu)

export default function PostgreSQL() {
  const queryClient = useQueryClient()
  let { data: connections, isLoading, isFetching } = trpc.postgresql.getConnections.useQuery()

  const [queryResult, setQueryResult] = useState<QueryResult>()
  const [query, setQuery] = useState<string>("")
  const [connectionId, setConnectionId] = useState<number>()
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseSchema[]>([])

  async function runQuery() {
    if (!connectionId) return toast.error("Choose a connection!")
    if (query === "") return toast.error("Query is empty!")

    const response = await fetch(`/api/postgresql/database?connectionId=${connectionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    })

    const queryResult = await response.json()
    if (!queryResult.isSuccessful) {
      toast.error(queryResult.message)
    } else {
      setQueryResult(queryResult.data)
    }
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
      ["postgresql", "getConnections"],
      {
        type: "query",
      },
    ])
  }

  const getDatabaseInfo = useCallback(async (connId: number | undefined) => {
    if (!connId || connId < 1) {
      toast.error("Something worng!")
      setDatabaseInfo([])
      return
    }

    setConnectionId(connId)

    const response = await fetch(`/api/postgresql/database?connectionId=${connId}`)
    const dbInfoResult: OperationResult<DatabaseSchema[]> = await response.json()

    if (dbInfoResult.isSuccessful && dbInfoResult.data) {
      setDatabaseInfo(dbInfoResult.data)
    } else {
      toast.error(dbInfoResult.message)
      setDatabaseInfo([])
    }
  }, [])

  const memoizedMenuProps = useMemo(
    () => ({
      connections: connections || [],
      getDatabaseInfo,
      databaseInfo,
    }),
    [connections, getDatabaseInfo, databaseInfo]
  )

  return (
    <>
      <ResizablePanelGroup direction="horizontal" className="min-h-screen min-w-full ">
        <ResizablePanel defaultSize={15}>
          <div className="flex justify-between  px-6 pt-4">
            <Link href="/">
              <Button size="sm">
                <Icons.left />
              </Button>
            </Link>
            <div className="flex gap-2">
              <PostreSQLForm
                formTrigger={
                  <Button variant="secondary" size="sm">
                    <Icons.plus />
                  </Button>
                }
              />

              <Button size="sm" onClick={refreshMenu}>
                <Icons.refresh />
              </Button>
            </div>
          </div>
          {isLoading && isFetching ? <SkeletonOfMenu /> : <MemorizedMenu {...memoizedMenuProps} />}
          {/* {true ? <SkeletonOfMenu /> : <MemorizedMenu {...memoizedMenuProps} />} */}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={85}>
          <div className="hidden flex-col md:flex">
            <div className="border-b">
              <div className="flex h-16 items-center px-4">
                <Button onClick={runQuery}>
                  <Icons.play className="mr-2 h-4 w-4" />
                  Run
                </Button>
                <Button onClick={formatQuery} className="ml-2">
                  Format
                </Button>
              </div>
            </div>
            <div className="flex-1">
              <ResizablePanelGroup direction="vertical" className="min-h-screen min-w-full">
                <ResizablePanel defaultSize={40}>
                  <Textarea
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="select * from users"
                    className="min-h-full w-full resize-none rounded-none font-semibold"
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={60}>
                  {queryResult && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {queryResult.fields.map((field, index) => (
                            <TableHead key={index}>{field}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {queryResult.rows.map((row, index) => (
                          <TableRow key={index}>
                            {row.map((column, idx) => (
                              <TableCell key={idx}>{column}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  )
}
