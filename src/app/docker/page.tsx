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

import { containersColumns } from "./_data/columns"

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
          <DataTable columns={containersColumns} data={containers || []} />
        </TabsContent>
        <TabsContent value="images">
          <Table>
            <TableCaption>Images</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Id</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>Tag</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {images?.map((image, index) => (
                <TableRow key={index}>
                  <TableCell>{image.Id.substring(0, 12)}</TableCell>
                  <TableCell>{image.RepoDigests}</TableCell>
                  <TableCell>{image.RepoTags}</TableCell>
                  <TableCell>{image.Size} byte</TableCell>
                  <TableCell>{image.Created}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="network">networks</TabsContent>
        <TabsContent value="volumes">volumes</TabsContent>
      </Tabs>
    </main>
  )
}
