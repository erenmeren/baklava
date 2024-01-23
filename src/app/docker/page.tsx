"use client"

import { trpc } from "@/utils/trpc"

import { DataTable } from "@/components/ui/datatable/data-table"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { containerColumns, imageColumns } from "./_data/columns"

export default function DockerHome() {
  const { data: containers, isLoading: isContainerLoading } = trpc.docker.getContainers.useQuery()

  const { data: images, isLoading: isImagesLoading } = trpc.docker.getImages.useQuery()

  const { data: volumes, isLoading: isVolumesLoading } = trpc.docker.getVolumes.useQuery()

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
          <DataTable columns={containerColumns} data={containers || []} />
        </TabsContent>
        <TabsContent value="images">
          <DataTable columns={imageColumns} data={images || []} />
        </TabsContent>
        <TabsContent value="network">networks</TabsContent>
        <TabsContent value="volumes">volumes</TabsContent>
      </Tabs>
    </main>
  )
}
