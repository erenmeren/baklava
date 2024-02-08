import { useEffect } from "react"

import { trpc } from "@/utils/trpc"
import { toast } from "sonner"
import PostreSQLForm from "../../forms/postgreSqlForm"
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import usePostgreSqlStore from "@/store/postgreSql/connectionStore"
import { PostgreSQLConnection } from "@/lib/types"

const SideMenu = () => {
  console.log("rendered side menu")

  const {
    connections,
    setConnections,
    connectionId,
    setConnectionId,
    schemas,
    setSchemas,
    deleteConnection,
  } = usePostgreSqlStore((state) => ({
    connections: state.connections,
    setConnections: state.setConnections,
    connectionId: state.connectionId,
    setConnectionId: state.setConnectionId,
    schemas: state.schemas,
    setSchemas: state.setSchemas,
    deleteConnection: state.deleteConnection,
  }))

  const { mutate: findAllConnections, isLoading: isConnectionsLoading } =
    trpc.postgresql.findAllConnections.useMutation({
      onSuccess: (result) => {
        setConnections(result)
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })

  const { mutate: getSchemasByConnectionId, isLoading: isDatabaseSchemasLoading } =
    trpc.postgresql.getSchemasByConnectionId.useMutation({
      onSuccess: (result) => {
        setSchemas(result)
      },
      onError: (error) => {
        toast.error(error.message)
      },
    })

  const { mutate: deleteConnection_ } = trpc.postgresql.deleteConnectionById.useMutation({
    onSuccess: (result) => {
      toast.success("Connection deleted!")
      deleteConnection(result)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  function getSchemas(connId: number) {
    if (connId !== connectionId) {
      getSchemasByConnectionId(connId)
      setConnectionId(connId)
    }
  }

  const deleteConnectionById = async (connId: number) => deleteConnection_(connId)

  useEffect(() => {
    findAllConnections()
  }, [])

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
                connections.map((conn: PostgreSQLConnection) => (
                  <AccordionItem key={conn.id} value={`val-${conn.id}`}>
                    <ContextMenu>
                      <ContextMenuTrigger className="text-sm">
                        <AccordionTrigger onClick={() => conn.id && getSchemas(conn.id)}>
                          <div className="flex">
                            <Icons.database size={18} />{" "}
                            <span className="mx-1">{conn.database}</span>
                          </div>
                        </AccordionTrigger>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-64">
                        <ContextMenuItem
                          inset
                          disabled={conn.id != connectionId}
                          onClick={() => getSchemas(conn.id as number)}
                        >
                          Reload
                        </ContextMenuItem>
                        <ContextMenuItem
                          inset
                          onClick={() => deleteConnectionById(conn.id as number)}
                          className="text-red-500"
                        >
                          Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    <AccordionContent>
                      {isDatabaseSchemasLoading ? (
                        <Loader className="ml-4" />
                      ) : (
                        schemas?.map((schema, index) => (
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
                                      <div className="flex">
                                        <AccordionTrigger></AccordionTrigger>
                                        <div className="mt-0.5 flex">
                                          <TooltipProvider>
                                            <Tooltip>
                                              <TooltipTrigger>
                                                <Icons.table
                                                  size={18}
                                                  color={
                                                    table.type === "VIEW" ? "#94a3b8" : "#111827"
                                                  }
                                                />
                                              </TooltipTrigger>
                                              <TooltipContent>
                                                <p>{table.type === "VIEW" ? "View" : "Table"}</p>
                                              </TooltipContent>
                                            </Tooltip>
                                          </TooltipProvider>

                                          <span className="mx-1">{table.name}</span>
                                        </div>
                                      </div>

                                      <AccordionContent className="mt-1">
                                        {table.columns.map((column, index) => (
                                          <div key={index} className="ml-3.5 flex">
                                            {/* <Icons.column size={18} /> */}
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
