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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Icons } from "@/components/icons"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Table } from "@/components/ui/table"

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
                    <Icons.database size={18} /> <span className="mx-1">{connection.database}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  {databaseInfo.map((schema, index) => (
                    <Accordion key={index} type="single" collapsible className="ml-3">
                      <AccordionItem value={`val-schema-${index}`}>
                        <AccordionTrigger>
                          <div className="flex">
                            <Icons.folder size={18} />
                            <span className="mx-1">{schema.name}</span>
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
                                    <div key={index} className="ml-3 flex">
                                      <Icons.column size={18} />
                                      <div className="ml-1 flex w-full justify-between">
                                        <HoverCard>
                                          <HoverCardTrigger asChild>
                                            <span className="hover:cursor-default hover:underline">
                                              {column.name}
                                            </span>
                                          </HoverCardTrigger>
                                          <HoverCardContent className="w-60">
                                            <div>
                                              <h4 className="mb-1 text-sm font-bold">
                                                @{column.name}
                                              </h4>
                                              <p className="text-xs">
                                                <span className="font-semibold">nullable</span>:
                                                <span className="ml-1">{column.isNullable}</span>
                                              </p>
                                              <p className="text-xs">
                                                <span className="font-semibold">udt</span>:
                                                <span className="ml-1">{column.udtName}</span>
                                              </p>
                                              <p className="text-xs">
                                                <span className="font-semibold">default</span>:
                                                <span className="ml-1">{column.defaultValue}</span>
                                              </p>
                                            </div>
                                          </HoverCardContent>
                                        </HoverCard>

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
        <div className="hidden flex-col md:flex">
          <div className="border-b">
            <div className="flex h-16 items-center px-4">
              <Button variant="secondary" className="justify-start">
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
                  placeholder="select * from users"
                  className="min-h-full w-full resize-none rounded-none font-semibold"
                />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={60}>
                <Table className="min-w-full"></Table>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
