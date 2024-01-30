import { create } from "zustand"

import { DatabaseSchema, PostgreSQLConnection, QueryResult } from "@/lib/types"
import { ContainerInfo, ImageInfo, NetworkInspectInfo, VolumeInspectInfo } from "dockerode"

const useDockerStore = create<{
  containers: ContainerInfo[]
  setContainers: (containers: ContainerInfo[]) => void
  deleteContainer: (id: string) => void
  updateContainer: (container: ContainerInfo) => void
  images: ImageInfo[]
  setImages: (images: ImageInfo[]) => void
  deleteImage: (id: string) => void
  networks: NetworkInspectInfo[]
  setNetworks: (networks: NetworkInspectInfo[]) => void
  volumes: VolumeInspectInfo[]
  setVolumes: (volumes: VolumeInspectInfo[]) => void
}>((set) => ({
  containers: [],
  setContainers: (containers) => set({ containers }),
  updateContainer: (container) =>
    set((state) => ({
      containers: state.containers.map((c) => (c.Id === container.Id ? container : c)),
    })),
  deleteContainer: (id) =>
    set((state) => ({ containers: state.containers.filter((container) => container.Id !== id) })),
  images: [],
  setImages: (images) => set({ images }),
  deleteImage: (id) =>
    set((state) => ({ images: state.images.filter((image) => image.Id !== id) })),
  networks: [],
  setNetworks: (networks) => set({ networks }),
  volumes: [],
  setVolumes: (volumes) => set({ volumes }),
}))

export default useDockerStore
