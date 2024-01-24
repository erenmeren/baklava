"use client"

import { trpc } from "@/utils/trpc"

import { DataTable } from "@/components/ui/datatable/data-table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { containerColumns, imageColumns, networkColumns, volumesColumns } from "./_data/columns"

export default function DockerHome() {
  const { data, isLoading } = trpc.docker.getDockerInfo.useQuery()

  return (
    <main className="p-6">
      <Tabs defaultValue="containers" className="w-full">
        <TabsList>
          <TabsTrigger value="containers">containers</TabsTrigger>
          <TabsTrigger value="images">images</TabsTrigger>
          <TabsTrigger value="network">networks</TabsTrigger>
          <TabsTrigger value="volumes">volumes</TabsTrigger>
        </TabsList>
        <TabsContent value="containers">
          <DataTable columns={containerColumns} data={data?.containers || []} />
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
  )
}
