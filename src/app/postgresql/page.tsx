"use client"

import { PostgreSQLConnection } from "@/lib/schemas"
import { useEffect, useState } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Icons } from "@/components/icons"

export default function PostgreSQL() {
  const [postgreConnections, setPostgreConnections] = useState<PostgreSQLConnection[]>([])

  useEffect(() => {
    const findAllPostgreSQLData = async () => {
      const response = await fetch("/api/postgresql/connection")
      const postgreConnections = await response.json()
      setPostgreConnections(postgreConnections)
    }

    findAllPostgreSQLData()
  }, [])

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="min-h-screen min-w-full rounded-lg border"
    >
      <ResizablePanel defaultSize={15}>
        <div className=" h-full p-6">
          <Accordion type="single" collapsible className="w-full">
            {postgreConnections.map((postgre) => (
              <AccordionItem key={postgre.id} value={`val-${postgre.id}`}>
                <AccordionTrigger>
                  <div className="flex">
                    <Icons.database /> <span className="ml-1 text-lg">{postgre.database}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div>{postgre.id}</div>
                  <div>{postgre.host}</div>
                  <div>{postgre.port}</div>
                  <div>{postgre.user}</div>
                  <div>{postgre.password}</div>
                  <div>{postgre.database}</div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={85}>
        <div className="flex h-full items-center justify-center p-6">
          <span className="font-semibold">Content</span>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
