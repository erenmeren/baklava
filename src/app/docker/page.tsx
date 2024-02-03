"use client"

import { useEffect } from "react"
import { trpc } from "@/utils/trpc"
import useDockerStore from "@/store/dockerStore"

import { DataTable } from "@/components/ui/datatable/data-table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { containerColumns, imageColumns, networkColumns, volumesColumns } from "./_data/columns"
import HomeButton from "@/components/homeButton"
import { toast } from "sonner"
import { Operation } from "@/lib/types"

export default function DockerHome() {
  const {
    containers,
    setContainers,
    updateContainer,
    deleteContainer,
    images,
    setImages,
    deleteImage,
    networks,
    setNetworks,
    deleteNetwork,
    volumes,
    setVolumes,
    deleteVolume,
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
    onSuccess: (result, input) => {
      if (input.type === Operation.START) {
        updateContainer(result)
        toast.success("Container started")
      } else if (input.type === Operation.STOP) {
        updateContainer(result)
        toast.success("Container stopped")
      } else if (input.type === Operation.RESTART) {
        updateContainer(result)
        toast.success("Container restarted")
      } else if (input.type === Operation.PAUSE) {
        updateContainer(result)
        toast.success("Container paused")
      } else if (input.type === Operation.DELETE) {
        deleteContainer(input.id)
        toast.success("Container deleted")
      } else if (input.type === Operation.UNPAUSE) {
        updateContainer(result)
        toast.success("Container unpaused")
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const { mutate: imageOperations } = trpc.docker.imageOperations.useMutation({
    onSuccess: (result, input) => {
      if (input.type === Operation.DELETE) {
        deleteImage(input.id)
        toast.success("Image deleted")
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const { mutate: networkOperations } = trpc.docker.networkOperations.useMutation({
    onSuccess: (result, input) => {
      if (input.type === Operation.DELETE) {
        deleteNetwork(input.id)
        toast.success("Network deleted")
      }
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const { mutate: volumeOperations } = trpc.docker.volumeOperations.useMutation({
    onSuccess: (result, input) => {
      if (input.type === Operation.DELETE) {
        deleteVolume(input.id)
        toast.success("Volume deleted")
      }
    },
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
            <DataTable columns={networkColumns(networkOperations)} data={networks} />
          </TabsContent>
          <TabsContent value="volumes">
            <DataTable columns={volumesColumns(volumeOperations)} data={volumes} />
          </TabsContent>
        </Tabs>
      </main>
    </>
  )
}
