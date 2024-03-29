import { convertTimestampToDate, formatBytes } from "@/lib/utils"
import { Icons } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { ColumnDef } from "@tanstack/react-table"
import { ContainerInfo, ImageInfo, NetworkInspectInfo, Port, VolumeInspectInfo } from "dockerode"
import { Badge } from "@/components/ui/badge"
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Operation } from "@/lib/types"

export const containerColumns = (containerOperations: any): ColumnDef<ContainerInfo, any>[] => {
  return [
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
      cell: ({ row }) => {
        return (
          <TooltipProvider key={row.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                {row.original.Status.includes("Up") ? (
                  row.original.Status.includes("Paused") ? (
                    <div className="cursor-default">
                      <Badge variant="outline" className=" bg-slate-400">
                        Paused
                      </Badge>
                    </div>
                  ) : (
                    <div className="cursor-default">
                      <Badge variant="outline" className=" bg-green-500">
                        Up
                      </Badge>
                    </div>
                  )
                ) : (
                  <div className="cursor-default">
                    <Badge>Down</Badge>
                  </div>
                )}
              </TooltipTrigger>
              <TooltipContent>{row.original.Status}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      },
    },
    {
      accessorKey: "Actions",
      header: "",
      cell: ({ row }) => {
        const isStatusUp = row.original.Status.includes("Up")
        const isPaused = row.original.Status.includes("Paused")

        return (
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant={!isStatusUp || isPaused ? "default" : "ghost"}
              onClick={() =>
                containerOperations({
                  id: row.original.Id,
                  type: isPaused ? Operation.UNPAUSE : Operation.START,
                })
              }
              disabled={isStatusUp && !isPaused}
            >
              <Icons.playCircle color="green" />
            </Button>
            <Button
              size="icon"
              variant={isStatusUp && !isPaused ? "default" : "ghost"}
              onClick={() => containerOperations({ id: row.original.Id, type: Operation.PAUSE })}
              disabled={!isStatusUp || isPaused}
            >
              <Icons.pauseCircle />
            </Button>
            <Button
              size="icon"
              variant={isStatusUp ? "default" : "ghost"}
              onClick={() => containerOperations({ id: row.original.Id, type: Operation.STOP })}
              disabled={!isStatusUp}
            >
              <Icons.stopCircle />
            </Button>
            <Button
              size="icon"
              variant={isStatusUp ? "default" : "ghost"}
              onClick={() => containerOperations({ id: row.original.Id, type: Operation.RESTART })}
              disabled={!isStatusUp}
            >
              <Icons.refresh />
            </Button>
            <Button
              size="icon"
              variant="destructive"
              onClick={() => containerOperations({ id: row.original.Id, type: Operation.DELETE })}
            >
              <Icons.trash />
            </Button>
          </div>
        )
      },
    },
  ]
}

export const imageColumns = (imageOperations: any): ColumnDef<ImageInfo, any>[] => {
  return [
    {
      accessorKey: "Id",
      header: "id",
      cell: ({ row }) => {
        const prefix = "sha256:"
        if (row.original.Id.startsWith(prefix)) {
          return row.original.Id.substring(prefix.length, prefix.length + 12)
        } else {
          return row.original.Id
        }
      },
    },
    {
      accessorKey: "Repository",
      header: "repository",
    },
    {
      accessorKey: "Tag",
      header: "tag",
    },
    {
      accessorKey: "Size",
      header: "size",
      cell: ({ row }) => {
        return formatBytes(row.original.Size)
      },
    },
    {
      accessorKey: "Created",
      header: "created at",
      cell: ({ row }) => {
        return convertTimestampToDate(row.original.Created)
      },
    },
    {
      accessorKey: "Actions",
      header: "",
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="destructive"
              onClick={() => imageOperations({ id: row.original.Id, type: Operation.DELETE })}
            >
              <Icons.trash />
            </Button>
          </div>
        )
      },
    },
  ]
}

export const networkColumns = (networkOperations: any): ColumnDef<NetworkInspectInfo, any>[] => [
  {
    accessorKey: "Id",
    header: "id",
    cell: ({ row }) => {
      return row.original.Id.substring(0, 12)
    },
  },
  {
    accessorKey: "Name",
    header: "name",
  },
  {
    accessorKey: "Scope",
    header: "scope",
  },
  {
    accessorKey: "Driver",
    header: "driver",
  },
  {
    accessorKey: "Actions",
    header: "",
    cell: ({ row }) => {
      return (
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="destructive"
            onClick={() => networkOperations({ id: row.original.Id, type: Operation.DELETE })}
          >
            <Icons.trash />
          </Button>
        </div>
      )
    },
  },
]

export const volumesColumns = (volumeOperations: any): ColumnDef<VolumeInspectInfo, any>[] => [
  {
    accessorKey: "Name",
    header: "name",
    cell: ({ row }) => {
      return row.original.Name.substring(0, 12)
    },
  },
  {
    accessorKey: "Driver",
    header: "driver",
  },
  // {
  //   accessorKey: "Mountpoint",
  //   header: "mount point",
  // },
  {
    accessorKey: "UsageData",
    header: "usage Data",
    cell: ({ row }) => {
      return (
        <div key={row.id}>
          {row.original.UsageData?.Size} / {row.original.UsageData?.RefCount}
        </div>
      )
    },
  },
  {
    accessorKey: "Actions",
    header: "",
    cell: ({ row }) => {
      return (
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="destructive"
            onClick={() => volumeOperations({ id: row.original.Name, type: Operation.DELETE })}
          >
            <Icons.trash />
          </Button>
        </div>
      )
    },
  },
]
