"use client"

import { trpc } from "@/utils/trpc"

import { DataTable } from "@/components/ui/datatable/data-table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { containerColumns, imageColumns, networkColumns, volumesColumns } from "./_data/columns"
import HomeButton from "@/components/homeButton"
import { toast } from "sonner"
import useDockerStore from "@/store/dockerStore"
import { useEffect } from "react"

export default function DockerHome() {
  const {
    containers,
    setContainers,
    images,
    setImages,
    networks,
    setNetworks,
    volumes,
    setVolumes,
  } = useDockerStore()

  const { data, isLoading } = trpc.docker.getDockerInfo.useQuery(undefined, {
    enabled: !containers.length && !images.length && !networks.length && !volumes.length,
  })

  useEffect(() => {
    if (data) {
      setContainers(data.containers || [])
      setImages(data.images || [])
      setNetworks(data.networks || [])
      setVolumes(data.volumes || [])
    }
  }, [data, setContainers, setImages, setNetworks, setVolumes])

  const { mutate: containerOperations } = trpc.docker.containerOperations.useMutation({
    onSuccess: (result) => {},
    onError: (error) => {
      toast.error(error.message)
    },
  })
  const { mutate: imageOperations } = trpc.docker.imageOperations.useMutation({
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
            <DataTable columns={containerColumns(containerOperations)} data={containers} />
          </TabsContent>
          <TabsContent value="images">
            <DataTable columns={imageColumns(imageOperations)} data={images} />
          </TabsContent>
          <TabsContent value="network">
            <DataTable columns={networkColumns} data={networks} />
          </TabsContent>
          <TabsContent value="volumes">
            <DataTable columns={volumesColumns} data={volumes} />
          </TabsContent>
        </Tabs>
      </main>
    </>
  )
}
