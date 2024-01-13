import { procedure, router } from "@/server/trpc"

import Dockerode, { ContainerInfo, ImageInfo } from "dockerode"

const docker: Dockerode = new Dockerode({ socketPath: "/var/run/docker.sock" })

export const dockerRouter = router({
  getContainers: procedure.query(async (): Promise<ContainerInfo[]> => {
    return docker.listContainers({ all: true })
  }),
  getImages: procedure.query(async (): Promise<ImageInfo[]> => {
    return docker.listImages({ all: true })
  }),
})
