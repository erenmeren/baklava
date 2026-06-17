// SERVER ONLY — imports driver code. Client code must import from ./meta or @/techs/meta-registry, never this file.
import type { TechModule } from "@/techs/contract";
import type { S3Config } from "@/lib/connections/types";
import { s3AwsClientFor, dropS3Client } from "@/lib/connections/s3-aws";
import { probe as s3Probe } from "@/lib/connections/s3";
import { blobBody } from "@/lib/connections/health";
import { s3Meta } from "./meta";

export const s3: TechModule<S3Config> = {
  ...s3Meta,
  driver: {
    probe: async (c: S3Config) => {
      const id = `__probe_${Math.random().toString(36).slice(2)}`;
      const client = await s3AwsClientFor(id, c);
      try {
        return await s3Probe(client);
      } finally {
        dropS3Client(id);
      }
    },
    health: blobBody,
  },
};
