import React from "react"

import SideMenu from "./sideMenu"
import EditorNavbar from "./navbar"
import QueryEditor from "./queryEditor"
import ResultOfQuery from "./queryResult"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../../ui/resizable"

import { ScrollArea } from "@radix-ui/react-scroll-area"

const SideMenuMemo = React.memo(SideMenu)
const QueryEditorMemo = React.memo(QueryEditor)

type Props = {
  databaseManagementSystem: "postgresql" | "mysql"
}

const DatabaseEditor: React.FC<Props> = ({ databaseManagementSystem }) => {
  return (
    <>
      <EditorNavbar databaseManagementSystem={databaseManagementSystem} />

      <ResizablePanelGroup direction="horizontal" className="h-full w-full flex-grow">
        <ResizablePanel defaultSize={15}>
          <SideMenuMemo />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={85}>
          <ResizablePanelGroup direction="vertical">
            <ResizablePanel defaultSize={40}>
              <ScrollArea className="h-full">
                <QueryEditorMemo />
              </ScrollArea>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={60}>
              <ResultOfQuery />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
      </ResizablePanelGroup>
    </>
  )
}

export default DatabaseEditor
