"use client"

import { trpc } from "@/utils/trpc"

import { DataTable } from "@/components/ui/datatable/data-table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { containerColumns, imageColumns, networkColumns, volumesColumns } from "./_data/columns"
import HomeButton from "@/components/homeButton"
import { toast } from "sonner"

export default function DockerHome() {
  const { data, isLoading } = trpc.docker.getDockerInfo.useQuery()

  const { mutate: containerOperations } = trpc.docker.containerOperations.useMutation({
    onSuccess: (result) => {},
    onError: (error) => {
      toast.error(error.message)
    },
  })

  return (
    <>
      <nav className="flex h-16 w-full items-center justify-between border-b px-4">
        <HomeButton />
      </nav>

      <main className="p-6">
        <Tabs defaultValue="containers" className="w-full">
          <TabsList>
            <TabsTrigger value="containers">containers</TabsTrigger>
            <TabsTrigger value="images">images</TabsTrigger>
            <TabsTrigger value="network">networks</TabsTrigger>
            <TabsTrigger value="volumes">volumes</TabsTrigger>
          </TabsList>
          <TabsContent value="containers">
            <DataTable
              columns={containerColumns(containerOperations)}
              data={data?.containers || []}
            />
          </TabsContent>
          <TabsContent value="images">
            <DataTable columns={imageColumns} data={data?.images || []} />
          </TabsContent>
          <TabsContent value="network">
            <DataTable columns={networkColumns} data={data?.networks || []} />
          </TabsContent>
          <TabsContent value="volumes">
            <DataTable columns={volumesColumns} data={data?.volumes || []} />
          </TabsContent>
        </Tabs>
      </main>
    </>
  )
}
