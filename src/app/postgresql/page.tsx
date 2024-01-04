"use client"

import { DatabaseSchema, OperationResult, PostgreSQLConnection } from "@/lib/schemas"
import { useEffect, useState } from "react"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Icons } from "@/components/icons"
import { toast } from "sonner"

export default function PostgreSQL() {
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseSchema[]>([])
  const [postgreSQLConnections, setPostgreSQLConnections] = useState<PostgreSQLConnection[]>([])

  useEffect(() => {
    const findAllPostgreSQLData = async () => {
      const response = await fetch("/api/postgresql/connection")
      const postgreSQLConnections: PostgreSQLConnection[] = await response.json()

      setPostgreSQLConnections(postgreSQLConnections)
      console.log(postgreSQLConnections)
    }

    findAllPostgreSQLData()
  }, [])

  async function fetchPostgreSQLData(connectionId: number) {
    setDatabaseInfo([])
    if (connectionId === -1) return toast.error("Something worng!")

    const response = await fetch(`/api/postgresql/database?connectionId=${connectionId}`)
    const dbInfoResult: OperationResult<DatabaseSchema[]> = await response.json()

    if (dbInfoResult.isSuccessful && dbInfoResult.data) {
      setDatabaseInfo(dbInfoResult.data)
    } else {
      toast.error(dbInfoResult.message)
    }
  }

  return (
    <ResizablePanelGroup
      direction="horizontal"
      className="min-h-screen min-w-full rounded-lg border"
    >
      <ResizablePanel defaultSize={15}>
        <div className=" h-full p-6">
          <Accordion type="single" collapsible className="w-full">
            {postgreSQLConnections.map((connection) => (
              <AccordionItem key={connection.id} value={`val-${connection.id}`}>
                <AccordionTrigger onClick={() => fetchPostgreSQLData(connection.id || -1)}>
                  <div className="flex">
                    <Icons.database /> <span className="mx-2 text-lg">{connection.database}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  {databaseInfo.map((schema, index) => (
                    <Accordion key={index} type="single" collapsible className="ml-3">
                      <AccordionItem value={`val-schema-${index}`}>
                        <AccordionTrigger>
                          <div className="flex">
                            <Icons.folder size={18} />
                            <span className="mx-1 ">{schema.name}</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          {schema.tables?.map((table, index) => (
                            <Accordion key={index} type="single" collapsible className="ml-3">
                              <AccordionItem value={`val-table-${index}`}>
                                <AccordionTrigger>
                                  <div className="flex">
                                    <Icons.table
                                      size={18}
                                      color={table.type === "VIEW" ? "#94a3b8" : "#111827"}
                                    />
                                    <span className="mx-1">{table.name}</span>
                                  </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                  {table.columns.map((column, index) => (
                                    <div key={index} className="ml-3  flex">
                                      <Icons.column size={18} />
                                      <div className="ml-1 flex w-full justify-between">
                                        <span>{column.name}</span>
                                        <span className="text-gray-500">{column.udtName}</span>
                                      </div>
                                    </div>
                                  ))}
                                </AccordionContent>
                              </AccordionItem>
                            </Accordion>
                          ))}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel defaultSize={85}>
        <div className="flex h-full items-center justify-center p-6">erenmeren</div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
