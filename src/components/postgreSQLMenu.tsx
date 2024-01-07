import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Icons } from "@/components/icons"
import { DatabaseSchema, PostgreSQLConnection } from "@/lib/schemas"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

interface Props {
  connections: PostgreSQLConnection[]
  getDatabaseInfo: (connId: number | undefined) => void
  databaseInfo: DatabaseSchema[]
}

export default function Menu({ connections, getDatabaseInfo, databaseInfo }: Props) {
  return (
    <div className="p-6">
      <Accordion type="single" collapsible className="w-full">
        {connections.map((conn) => (
          <AccordionItem key={conn.id} value={`val-${conn.id}`}>
            <ContextMenu>
              <ContextMenuTrigger>
                <AccordionTrigger onClick={() => getDatabaseInfo(conn.id)}>
                  <div className="flex">
                    <Icons.database size={18} /> <span className="mx-1">{conn.database}</span>
                  </div>
                </AccordionTrigger>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem>
                  <Icons.trash size={18} className="mr-1" />
                  Delete
                </ContextMenuItem>
                <ContextMenuItem>
                  <Icons.edit size={18} className="mr-1" />
                  Edit
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
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
                                          <h4 className="mb-1 text-sm font-bold">@{column.name}</h4>
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
  )
}
