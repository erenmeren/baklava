// SERVER ONLY — imports driver code. Client code must use ./meta or @/techs/meta-registry.
import type { TechModule } from "@/techs/contract";
import type { QdrantConfig } from "@/lib/connections/types";
import { probeQdrant } from "@/lib/connections/qdrant";
import { qdrantBody } from "@/lib/connections/health";
import { qdrantMeta } from "./meta";

export const qdrant: TechModule<QdrantConfig> = {
  ...qdrantMeta,
  driver: { probe: (c) => probeQdrant(c), health: qdrantBody },
};
