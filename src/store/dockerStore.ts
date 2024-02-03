import { create } from "zustand"

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
  deleteNetwork: (id: string) => void
  volumes: VolumeInspectInfo[]
  setVolumes: (volumes: VolumeInspectInfo[]) => void
  deleteVolume: (id: string) => void
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
  deleteNetwork: (id) => set((state) => ({ networks: state.networks.filter((n) => n.Id !== id) })),
  volumes: [],
  setVolumes: (volumes) => set({ volumes }),
  deleteVolume: (id) => set((state) => ({ volumes: state.volumes.filter((v) => v.Name !== id) })),
}))

export default useDockerStore
