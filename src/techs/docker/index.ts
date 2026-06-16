// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { DockerConfig } from "@/lib/connections/types";
import { pingDocker } from "@/lib/connections/docker";
import { dockerMeta } from "./meta";

export const docker: TechModule<DockerConfig> = {
  ...dockerMeta,
  driver: { probe: (c) => pingDocker(c) },
};
