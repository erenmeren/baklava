// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { MinioConfig } from "@/lib/connections/types";
import { minioClientFor, dropMinioClient } from "@/lib/connections/minio";
import { probe as s3Probe } from "@/lib/connections/s3";
import { blobBody } from "@/lib/connections/health";
import { minioMeta } from "./meta";

export const minio: TechModule<MinioConfig> = {
  ...minioMeta,
  driver: {
    probe: async (c: MinioConfig) => {
      const id = `__probe_${Math.random().toString(36).slice(2)}`;
      const client = await minioClientFor(id, c);
      try {
        return await s3Probe(client);
      } finally {
        dropMinioClient(id);
      }
    },
    health: blobBody,
  },
};
