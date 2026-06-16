import { z } from "zod";
import type { TechModule } from "@/techs/contract";
import type { DockerConfig, ConnectionRecord } from "@/lib/connections/types";
import { pingDocker } from "@/lib/connections/docker";

const schema = z.object({
  mode: z.enum(["socket", "tcp"]),
  socketPath: z.string().optional(),
  host: z.string().optional(),
  port: z.number().optional(),
  protocol: z.enum(["http", "https"]).optional(),
});

export const docker: TechModule<DockerConfig> = {
  id: "docker",
  catalog: {
    id: "docker",
    name: "Docker",
    tagline: "Container engine",
    description: "Inspect and manage containers, images, networks and volumes.",
    category: "Runtime",
    color: "from-sky-400 to-blue-600",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<DockerConfig>, secretKeys: [] },
  driver: { probe: (c) => pingDocker(c) },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as DockerConfig;
    return cfg.mode === "tcp"
      ? `${cfg.protocol}://${cfg.host}:${cfg.port}`
      : `socket: ${cfg.socketPath}`;
  },
  firstPage: "containers",
  optionalDeps: ["dockerode", "ssh2"],
  serverPackages: ["dockerode", "ssh2"],
  capabilities: { browse: true, health: true },
};
