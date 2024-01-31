import { DockerInfo, DockerOperationSchema, Operation } from "@/lib/types"
import { procedure, router } from "@/server/trpc"

import Dockerode, { ContainerInspectInfo } from "dockerode"

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
  containerOperations: procedure
    .input(DockerOperationSchema)
    .mutation(async ({ input }): Promise<ContainerInspectInfo> => {
      const container = docker.getContainer(input.id)

      docker.listContainers()

      if (input.type === Operation.START) {
        await container.start()
      } else if (input.type === Operation.PAUSE) {
        await container.pause()
      } else if (input.type === Operation.STOP) {
        await container.stop()
      } else if (input.type === Operation.RESTART) {
        await container.restart()
      } else if (input.type === Operation.DELETE) {
        await container.remove()
      } else if (input.type === Operation.UNPAUSE) {
        await container.unpause()
      }

      return container.inspect()
    }),
  imageOperations: procedure.input(DockerOperationSchema).mutation(async ({ input }) => {
    const image = docker.getImage(input.id)
    if (input.type === Operation.DELETE) {
      await image.remove()
    }
  }),
})
