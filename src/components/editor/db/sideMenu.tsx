import { useEffect, useState } from "react"

import { trpc } from "@/utils/trpc"
import PostreSQLForm from "../../forms/postgreSQLForm"
import { Icons } from "../../icons"
import { Button } from "../../ui/button"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { DatabaseSchema } from "@/lib/types"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../ui/accordion"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../ui/hover-card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu"
import Loader from "@/components/loader"

type Props = {
  databaseManagementSystem: string
  connectionId: number
  setConnectionId: (connectionId: number) => void
}

const SideMenu: React.FC<Props> = ({ databaseManagementSystem, connectionId, setConnectionId }) => {
  const [databaseInfo, setDatabaseInfo] = useState<DatabaseSchema[]>([])

  const queryClient = useQueryClient()

  let {
    data: connections,
    isLoading: isConnectionsLoading,
    isFetching: isConnectionsFetching,
  } = trpc.postgresql.findAllConnections.useQuery()

  let {
    data: dbInfo,
    isLoading: isDbInfoLoading,
    isFetching: isDbInfoFetching,
  } = trpc.postgresql.getDatabaseInfoByConnectionId.useQuery(connectionId, {
    onSuccess: (data) => {
      setDatabaseInfo(data)
    },
    onError: (error) => {
      setConnectionId(0)
      toast.error(error.message)
    },
    enabled: connectionId > 0,
    retry: false,
  })

  useEffect(() => {
    if (connectionId > 0) {
      queryClient.invalidateQueries(["getDatabaseInfoByConnectionId", connectionId])
    }
  }, [connectionId])

  const refreshMenu = async () => {
    queryClient.refetchQueries([
      [databaseManagementSystem, "findAllConnections"],
      {
        type: "query",
      },
    ])
  }

  const getDatabaseInfo = async (connId: number) => {
    setDatabaseInfo([])

    if (!connId || connId < 1) {
      toast.error("Something worng!")
      return
    }

    setConnectionId(connId)
  }

  return (
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
        {isConnectionsLoading && isConnectionsFetching ? (
          <Loader />
        ) : (
          <div className="">
            {connections && connections.length === 0 && <>No connection</>}
            <Accordion type="single" collapsible className="w-full">
              {connections &&
                connections.map((conn) => (
                  <AccordionItem key={conn.id} value={`val-${conn.id}`}>
                    <ContextMenu>
                      <ContextMenuTrigger className="text-sm">
                        <AccordionTrigger onClick={() => conn.id && getDatabaseInfo(conn.id)}>
                          <div className="flex">
                            <Icons.database size={18} />{" "}
                            <span className="mx-1">{conn.database}</span>
                          </div>
                        </AccordionTrigger>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-64">
                        <ContextMenuItem inset>Delete</ContextMenuItem>
                        <ContextMenuItem inset disabled>
                          Reload
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    <AccordionContent>
                      {isDbInfoFetching || isDbInfoLoading ? (
                        <Loader className="ml-4" />
                      ) : (
                        databaseInfo.map((schema, index) => (
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
                                        <div className="flex ">
                                          <Icons.table
                                            size={18}
                                            color={table.type === "VIEW" ? "#94a3b8" : "#111827"}
                                          />
                                          <span className="mx-1">{table.name}</span>
                                        </div>
                                      </AccordionTrigger>
                                      <AccordionContent>
                                        {table.columns.map((column, index) => (
                                          <div key={index} className="ml-5 flex">
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
                                                      <span className="font-semibold">
                                                        nullable
                                                      </span>
                                                      :
                                                      <span className="ml-1">
                                                        {column.isNullable}
                                                      </span>
                                                    </p>
                                                    <p className="text-xs">
                                                      <span className="font-semibold">udt</span>:
                                                      <span className="ml-1">{column.udtName}</span>
                                                    </p>
                                                    <p className="text-xs">
                                                      <span className="font-semibold">default</span>
                                                      :
                                                      <span className="ml-1">
                                                        {column.defaultValue}
                                                      </span>
                                                    </p>
                                                  </div>
                                                </HoverCardContent>
                                              </HoverCard>

                                              <span className="text-gray-500">
                                                {column.udtName}
                                              </span>
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
                        ))
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
            </Accordion>
          </div>
        )}
      </div>
    </div>
  )
}

export default SideMenu
