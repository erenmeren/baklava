"use client"

import { DatabaseSchema, OperationResult, QueryResult } from "@/lib/types"
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
import SkeletonOfMenu from "@/components/postgreSQLMenu.skeleton"
import { Icons } from "@/components/icons"
import PostreSQLForm from "@/components/forms/postgreSQLForm"
import Link from "next/link"
import { format } from "sql-formatter"
import { trpc } from "@/utils/trpc"
import { useQueryClient } from "@tanstack/react-query"

// import CodeMirror from "@uiw/react-codemirror"

import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Separator } from "@/components/ui/separator"

const DB_NAME = "postgresql"
const MemorizedMenu = memo(Menu)

export default function PostgreSQLHome() {
  const [queryResult, setQueryResult] = useState<QueryResult>()
  const [query, setQuery] = useState<string>("")
  const [connectionId, setConnectionId] = useState<number>()
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseSchema[]>([])
  const [openCommand, setOpenCommand] = useState(false)

  const queryClient = useQueryClient()
  let { data: connections, isLoading, isFetching } = trpc.postgresql.getConnections.useQuery()

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
      [DB_NAME, "getConnections"],
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpenCommand((open) => !open)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "r" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        runQuery()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        formatQuery()
      }
    }
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [query])

  return (
    <>
      <nav className="flex h-16  items-center justify-between border-b px-4">
        <Link href="/">
          <Button variant="secondary" size="icon">
            <Icons.left />
          </Button>
        </Link>
        <div>
          <Button size="icon" variant="secondary" onClick={runQuery}>
            <Icons.play />
          </Button>
          <Button size="icon" variant="secondary" onClick={formatQuery} className="ml-2">
            <Icons.text />
          </Button>
        </div>
      </nav>

      <ResizablePanelGroup direction="horizontal" className="min-h-screen min-w-full">
        <ResizablePanel defaultSize={15}>
          <div className="px-6">
            <div className="flex justify-between pt-4 ">
              <span className="mt-2 font-semibold">Connections</span>

              <div className="flex">
                <PostreSQLForm
                  formTrigger={
                    <Button variant="ghost" size="icon">
                      <Icons.plus className="h-4 w-4" />
                    </Button>
                  }
                />
                <Button variant="ghost" size="icon" onClick={refreshMenu}>
                  <Icons.refresh className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="">
              {isLoading && isFetching ? (
                <SkeletonOfMenu />
              ) : (
                <MemorizedMenu {...memoizedMenuProps} />
              )}
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={85}>
          <div className="hidden flex-col md:flex">
            <div className="flex-1">
              <ResizablePanelGroup direction="vertical" className="min-h-screen min-w-full">
                <ResizablePanel defaultSize={40}>
                  {/* <CodeMirror
                    value={query}
                    className="min-h-full w-full resize-none rounded-none font-semibold"
                  /> */}

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
      <CommandDialog open={openCommand} onOpenChange={setOpenCommand}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandItem>
            <Icons.play className="mr-2 h-4 w-4" />
            <span>Run</span>
            <CommandShortcut>⌘R</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <Icons.text className="mr-2 h-4 w-4" />
            <span>Format</span>
            <CommandShortcut>⌘F</CommandShortcut>
          </CommandItem>
        </CommandList>
      </CommandDialog>
    </>
  )
}
