import type { TechId } from "@/lib/connections/types";
import type { TechModule } from "./contract";
import { docker } from "./docker";
import { postgres } from "./postgres";
import { kafka } from "./kafka";
import { mysql } from "./mysql";
import { sqlserver } from "./sqlserver";
import { kubernetes } from "./kubernetes";
import { redis } from "./redis";
import { mongo } from "./mongo";
import { r2 } from "./r2";
import { minio } from "./minio";
import { s3 } from "./s3";
import { qdrant } from "./qdrant";

// Order here = home-grid connection order. `Record<TechId, …>` makes tsc fail
// if any TechId is missing a module — that is the completeness check.
export const TECH_MODULES: Record<TechId, TechModule> = {
  docker, postgres, kafka, mysql, sqlserver, kubernetes, redis, mongo, r2, minio, s3, qdrant,
};

export const TECH_MODULE_LIST: TechModule[] = [
  docker, postgres, kafka, mysql, sqlserver, kubernetes, redis, mongo, r2, minio, s3, qdrant,
];

export const techById = new Map<string, TechModule>(
  TECH_MODULE_LIST.map((m) => [m.id, m]),
);

export function requireTechModule(id: TechId): TechModule {
  const m = techById.get(id);
  if (!m) throw new Error(`No tech module registered for "${id}"`);
  return m;
}
