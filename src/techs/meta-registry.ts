// Client-safe registry: metadata only, NO driver code. Safe to import from client
// components (home grid, command palette, connection sheet…). Server code that
// needs drivers/health uses ./registry instead.
import type { TechId } from "@/lib/connections/types";
import type { TechModuleMeta } from "./contract";
import { dockerMeta } from "./docker/meta";
import { postgresMeta } from "./postgres/meta";
import { kafkaMeta } from "./kafka/meta";
import { mysqlMeta } from "./mysql/meta";
import { sqlserverMeta } from "./sqlserver/meta";
import { kubernetesMeta } from "./kubernetes/meta";
import { redisMeta } from "./redis/meta";
import { mongoMeta } from "./mongo/meta";
import { r2Meta } from "./r2/meta";
import { minioMeta } from "./minio/meta";
import { s3Meta } from "./s3/meta";

export const TECH_META: Record<TechId, TechModuleMeta> = {
  docker: dockerMeta, postgres: postgresMeta, kafka: kafkaMeta, mysql: mysqlMeta,
  sqlserver: sqlserverMeta, kubernetes: kubernetesMeta, redis: redisMeta, mongo: mongoMeta,
  r2: r2Meta, minio: minioMeta, s3: s3Meta,
};

export const TECH_META_LIST: TechModuleMeta[] = [
  dockerMeta, postgresMeta, kafkaMeta, mysqlMeta, sqlserverMeta, kubernetesMeta,
  redisMeta, mongoMeta, r2Meta, minioMeta, s3Meta,
];

export const techMetaById = new Map<string, TechModuleMeta>(
  TECH_META_LIST.map((m) => [m.id, m]),
);

export function requireTechMeta(id: TechId): TechModuleMeta {
  const m = techMetaById.get(id);
  if (!m) throw new Error(`No tech meta registered for "${id}"`);
  return m;
}
