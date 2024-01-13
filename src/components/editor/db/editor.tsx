import React, { useEffect, useState } from "react"

import { QueryResult } from "@/lib/types"
import { trpc } from "@/utils/trpc"
import { toast } from "sonner"
import { format } from "sql-formatter"

import SideMenu from "./sideMenu"
import EditorNavbar from "./navbar"
import QueryEditor from "./queryEditor"
import ResultOfQuery from "./queryResult"
import CommandBar from "./commandBar"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../ui/resizable"

const SideMenuMemo = React.memo(SideMenu)
// const QueryEditorMemo = React.memo(QueryEditor)
// const ResultOfQueryMemo = React.memo(ResultOfQuery)

type Props = {
  databaseManagementSystem: "postgresql" | "mysql"
}

const DatabaseEditor: React.FC<Props> = ({ databaseManagementSystem }) => {
  const [openCommand, setOpenCommand] = useState(false)
  const [queryResult, setQueryResult] = useState<QueryResult>()
  const [query, setQuery] = useState<string>("")
  const [connectionId, setConnectionId] = useState<number>(0)

  const { mutate: _runQuery } = trpc.postgresql.runQuery.useMutation({
    onSuccess: (result) => {
      setQueryResult(result)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  async function runQuery() {
    if (!connectionId) return toast.error("Choose a connection!")
    if (query === "") return toast.error("Query is empty!")

    _runQuery({ connectionId, query })
  }

  function formatQuery() {
    setQuery(
      format(query, {
        language: databaseManagementSystem,
        tabWidth: 2,
        keywordCase: "upper",
        linesBetweenQueries: 2,
      })
    )
  }

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
  }, [query])

  return (
    <>
      <EditorNavbar runQuery={runQuery} formatQuery={formatQuery} />

      <ResizablePanelGroup direction="horizontal" className="h-full w-full flex-grow">
        <ResizablePanel defaultSize={15}>
          <SideMenuMemo
            databaseManagementSystem={databaseManagementSystem}
            connectionId={connectionId}
            setConnectionId={setConnectionId}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={85}>
          <>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={40}>
                <QueryEditor query={query} setQuery={setQuery} />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={60}>
                <ResultOfQuery queryResult={queryResult} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </>
        </ResizablePanel>
      </ResizablePanelGroup>

      <CommandBar openCommand={openCommand} setOpenCommand={setOpenCommand} />
    </>
  )
}

export default DatabaseEditor
