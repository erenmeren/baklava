import { convertTimestampToDate } from "@/lib/utils"
import { Icons } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { ColumnDef } from "@tanstack/react-table"
import { ContainerInfo, Port } from "dockerode"

export const containersColumns: ColumnDef<ContainerInfo, any>[] = [
  {
    accessorKey: "Id",
    header: "id",
    cell: ({ row }) => {
      return row.original.Id.substring(0, 12)
    },
  },
  {
    accessorKey: "Image",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          image
          <Icons.sort className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => {
      const prefix = "sha256:"

      if (row.original.Image.startsWith(prefix)) {
        return row.original.Image.substring(prefix.length, prefix.length + 12)
      } else {
        return row.original.Image
      }
    },
  },
  {
    accessorKey: "Ports",
    header: "ports",
    cell: ({ row }) => {
      return row.original.Ports.map((port: Port, index: number) => (
        <div key={port.PrivatePort + "-" + index}>
          {`${port.IP}:${port.PrivatePort} -> ${port.PublicPort}/${port.Type}`}
        </div>
      ))
    },
  },
  {
    accessorKey: "Command",
    header: "command",
  },
  {
    accessorKey: "Created",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          created at
          <Icons.sort className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => {
      return convertTimestampToDate(row.original.Created)
    },
  },
  {
    accessorKey: "Status",
    header: "status",
  },
]
