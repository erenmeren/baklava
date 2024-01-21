import { procedure, router } from "@/server/trpc"

import Dockerode, { ContainerInfo, ImageInfo, VolumeInspectInfo } from "dockerode"

const docker: Dockerode = new Dockerode({ socketPath: "/var/run/docker.sock" })

export const dockerRouter = router({
  getContainers: procedure.query(async (): Promise<ContainerInfo[]> => {
    return docker.listContainers({ all: true })
  }),
  getImages: procedure.query(async (): Promise<ImageInfo[]> => {
    return docker.listImages({ all: true })
  }),
  getVolumes: procedure.query(async (): Promise<VolumeInspectInfo[]> => {
    const { Volumes } = await docker.listVolumes({ all: true })
    return Volumes
  }),
})
