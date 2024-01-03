"use client"

import { PostgreSQLForm } from "@/lib/schemas"
import { useState } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"

export default function PostgreSQL() {
  const [postgres, setPostgres] = useState<PostgreSQLForm[]>([])

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="min-h-screen min-w-full rounded-lg border"
    >
      <ResizablePanel defaultSize={22}>
        <div className="flex h-full items-center justify-center p-6">
          <span className="font-semibold">Sidebar</span>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={80}>
        <div className="flex h-full items-center justify-center p-6">
          <span className="font-semibold">Content</span>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
