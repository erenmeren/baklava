import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { trpc } from "@/utils/trpc"

import { toast } from "sonner"
import PostreSQLForm from "../../forms/postgreSQLForm"
import { Icons } from "../../icons"
import { Button } from "../../ui/button"
import Loader from "../../loader"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../ui/hover-card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../ui/accordion"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../ui/context-menu"

type Props = {
  databaseManagementSystem: string
  connectionId: number
  setConnectionId: (connectionId: number) => void
}

const SideMenu: React.FC<Props> = ({ databaseManagementSystem, connectionId, setConnectionId }) => {
  const queryClient = useQueryClient()

  let { data: connections, isLoading: isConnectionsLoading } =
    trpc.postgresql.findAllConnections.useQuery()

  let {
    data: databaseSchemas,
    isLoading: isDatabaseSchemasLoading,
    isFetching: isDatabaseSchemasFetching,
  } = trpc.postgresql.getSchemasByConnectionId.useQuery(connectionId, {
    onError: (error) => {
      setConnectionId(0)
      toast.error(error.message)
    },
    enabled: connectionId > 0,
    retry: false,
  })

  const { mutate: deleteConnection } = trpc.postgresql.deleteConnectionById.useMutation({
    onSuccess: (result) => {
      toast.success("Connection deleted!")
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  useEffect(() => {
    if (connectionId > 0) {
      queryClient.invalidateQueries([
        databaseManagementSystem,
        "getDatabaseInfoByConnectionId",
        connectionId,
      ])
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

  const deleteConnectionById = async (connId: number) => deleteConnection(connId)

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
        {isConnectionsLoading ? (
          <Loader />
        ) : (
          <div>
            {connections && connections.length === 0 && <em>No connection</em>}
            <Accordion type="single" collapsible className="w-full">
              {connections &&
                connections.map((conn) => (
                  <AccordionItem key={conn.id} value={`val-${conn.id}`}>
                    <ContextMenu>
                      <ContextMenuTrigger className="text-sm">
                        <AccordionTrigger onClick={() => conn.id && setConnectionId(conn.id)}>
                          <div className="flex">
                            <Icons.database size={18} />{" "}
                            <span className="mx-1">{conn.database}</span>
                          </div>
                        </AccordionTrigger>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-64">
                        <ContextMenuItem
                          inset
                          onClick={() => deleteConnectionById(conn.id as number)}
                        >
                          Delete
                        </ContextMenuItem>
                        <ContextMenuItem inset disabled>
                          Reload
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    <AccordionContent>
                      {isDatabaseSchemasLoading || isDatabaseSchemasFetching ? (
                        <Loader className="ml-4" />
                      ) : (
                        databaseSchemas?.map((schema, index) => (
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
