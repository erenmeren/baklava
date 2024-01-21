"use client"

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

import { trpc } from "@/utils/trpc"

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
          <Table>
            <TableCaption>Containers</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Id</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>Ports</TableHead>
                <TableHead>Command</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {containers?.map((container, index) => (
                <TableRow key={index}>
                  <TableCell>{container.Id.substring(0, 12)}</TableCell>
                  <TableCell>{container.Image.substring(0, 12)}</TableCell>
                  <TableCell>
                    {container.Ports.map((port, index) => {
                      return (
                        <div key={port.PrivatePort + "-" + index}>
                          {`${port.IP}:${port.PrivatePort} -> ${port.PublicPort}/${port.Type},  `}
                        </div>
                      )
                    })}
                  </TableCell>
                  <TableCell>{container.Command}</TableCell>
                  <TableCell>{container.Created}</TableCell>
                  <TableCell>{container.Status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
      </Tabs>
    </main>
  )
}
