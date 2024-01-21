import React, { useCallback, useEffect, useState } from "react"

import { trpc } from "@/utils/trpc"
import { toast } from "sonner"
import { format } from "sql-formatter"

import SideMenu from "./sideMenu"
import EditorNavbar from "./navbar"
import QueryEditor from "./queryEditor"
import ResultOfQuery from "./queryResult"
import CommandBar from "./commandBar"

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../ui/resizable"
import usePostgreSqlStore from "@/store/postgreSql"

const SideMenuMemo = React.memo(SideMenu)

type Props = {
  databaseManagementSystem: "postgresql" | "mysql"
}

const DatabaseEditor: React.FC<Props> = ({ databaseManagementSystem }) => {
  const [openCommand, setOpenCommand] = useState(false)

  const { connectionId, query, setQuery, setQueryResult } = usePostgreSqlStore()

  const { mutate: _runQuery } = trpc.postgresql.runQuery.useMutation({
    onSuccess: (result) => {
      setQueryResult(result)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const runQuery = useCallback(() => {
    if (!connectionId) return toast.error("Choose a connection!")
    if (query === "") return toast.error("Query is empty!")

    _runQuery({ connectionId, query })
  }, [connectionId, query, _runQuery]) // Bağımlılıkları ekleyin

  const formatQuery = useCallback(() => {
    setQuery(
      format(query, {
        language: databaseManagementSystem,
        tabWidth: 2,
        keywordCase: "upper",
        linesBetweenQueries: 2,
      })
    )
  }, [query, databaseManagementSystem])

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
  }, [runQuery, formatQuery])

  return (
    <>
      <EditorNavbar runQuery={runQuery} formatQuery={formatQuery} />

      <ResizablePanelGroup direction="horizontal" className="h-full w-full flex-grow">
        <ResizablePanel defaultSize={15}>
          <SideMenuMemo />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={85}>
          <>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={40}>
                <QueryEditor />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={60}>
                <ResultOfQuery />
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
