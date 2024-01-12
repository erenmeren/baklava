import DatabaseMenu from "./databaseMenu"
import EditorNavbar from "./navbar"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import QueryEditor from "./queryEditor"
import ResultOfQuery from "./resultOfQuery"
import CommandBar from "./commandBar"
import { QueryResult } from "@/lib/types"

type Props = {
  openCommand: boolean
  setOpenCommand: (openCommand: boolean) => void
  query: string
  setQuery: (query: string) => void
  queryResult: QueryResult | undefined
  runQuery: () => void
  formatQuery: () => void
  refreshMenu: () => void
  isLoading: boolean
  isFetching: boolean
  memoizedMenuProps: any
  MemorizedMenu: any
}

const DatabaseEditor: React.FC<Props> = ({
  openCommand,
  setOpenCommand,
  query,
  setQuery,
  queryResult,
  runQuery,
  formatQuery,
  refreshMenu,
  isLoading,
  isFetching,
  memoizedMenuProps,
  MemorizedMenu,
}) => {
  return (
    <>
      <EditorNavbar runQuery={runQuery} formatQuery={formatQuery} />

      <ResizablePanelGroup direction="horizontal" className="h-full w-full flex-grow">
        <ResizablePanel defaultSize={15}>
          <DatabaseMenu
            refreshMenu={refreshMenu}
            isLoading={isLoading}
            isFetching={isFetching}
            memoizedMenuProps={memoizedMenuProps}
            MemorizedMenu={MemorizedMenu}
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
