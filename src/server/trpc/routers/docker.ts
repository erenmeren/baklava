import { DockerInfo } from "@/lib/types"
import { procedure, router } from "@/server/trpc"

import Dockerode from "dockerode"

const docker: Dockerode = new Dockerode({ socketPath: "/var/run/docker.sock" })

export const dockerRouter = router({
  getDockerInfo: procedure.query(async (): Promise<DockerInfo> => {
    const [containers, images, networks, volumes] = await Promise.all([
      docker.listContainers({ all: true }),
      docker.listImages({ all: true }),
      docker.listNetworks({ all: true }),
      docker.listVolumes({ all: true }),
    ])

    return {
      containers,
      images,
      networks,
      volumes: volumes.Volumes,
    }
  }),
})
