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
import { Separator } from "@/components/ui/separator"

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
                    <Icons.database /> <span className="ml-1 text-lg">{connection.database}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  {databaseInfo.map((db) => (
                    <>
                      <div className="flex">
                        <Icons.folder /> {db.name}
                      </div>

                      {/* <ul>
                        {db.tables?.map((table) => (
                          <>
                            <li>
                              <div className="flex">
                                <Icons.table /> {table.name}
                              </div>

                              <ul>
                                {table.columns.map((column) => (
                                  <li>
                                    <div className="flex">
                                      <Icons.column /> {column.name}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          </>
                        ))}
                      </ul> */}
                    </>
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
