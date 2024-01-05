"use client"

import { DatabaseSchema, OperationResult, PostgreSQLConnection, QueryResult } from "@/lib/schemas"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
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

const MemorizedMenu = memo(Menu)

export default function PostgreSQL() {
  console.log("App render")

  const [queryResult, setQueryResult] = useState<QueryResult>()
  const [query, setQuery] = useState<string>("")
  const [connectionId, setConnectionId] = useState<number>()
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseSchema[]>([])
  const [connections, setConnections] = useState<PostgreSQLConnection[]>([])

  useEffect(() => {
    const findAllPostgreSQLConnections = async () => {
      const response = await fetch("/api/postgresql/connection")
      const postgreSQLConnections: PostgreSQLConnection[] = await response.json()

      setConnections(postgreSQLConnections)
    }
    findAllPostgreSQLConnections()
  }, [])

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
      connections,
      getDatabaseInfo,
      databaseInfo,
    }),
    [connections, getDatabaseInfo, databaseInfo]
  )

  return (
    <>
      <ResizablePanelGroup
        direction="horizontal"
        className="min-h-screen min-w-full rounded-lg border"
      >
        <ResizablePanel defaultSize={15}>
          <MemorizedMenu {...memoizedMenuProps} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={85}>
          <div className="hidden flex-col md:flex">
            <div className="border-b">
              <div className="flex h-16 items-center px-4">
                <Button variant="secondary" className="justify-start" onClick={runQuery}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mr-2 h-4 w-4"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polygon points="10 8 16 12 10 16 10 8" />
                  </svg>
                  Run
                </Button>
              </div>
            </div>
            <div className="flex-1">
              <ResizablePanelGroup direction="vertical" className="min-h-screen min-w-full">
                <ResizablePanel defaultSize={40}>
                  <Textarea
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
