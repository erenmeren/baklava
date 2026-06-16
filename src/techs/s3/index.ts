import { z } from "zod";
import type { TechModule } from "@/techs/contract";
import type { S3Config, ConnectionRecord } from "@/lib/connections/types";
import { s3AwsClientFor, dropS3Client } from "@/lib/connections/s3-aws";
import { probe as s3Probe } from "@/lib/connections/s3";

const schema = z.object({
  region: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string().optional(),
  bucket: z.string().optional(),
});

export const s3: TechModule<S3Config> = {
  id: "s3",
  catalog: {
    id: "s3",
    name: "Amazon S3",
    tagline: "Object storage",
    description:
      "AWS S3 object browser: buckets, prefix navigation, upload/download, presigned links, CORS and lifecycle.",
    category: "Storage",
    color: "from-green-500 to-teal-600",
    status: "available",
  },
  config: {
    schema: schema as unknown as z.ZodType<S3Config>,
    secretKeys: ["secretAccessKey", "sessionToken"],
  },
  driver: {
    probe: async (c: S3Config) => {
      const id = `__probe_${Math.random().toString(36).slice(2)}`;
      const client = s3AwsClientFor(id, c);
      try {
        return await s3Probe(client);
      } finally {
        dropS3Client(id);
      }
    },
  },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as S3Config;
    const bucket = cfg.bucket ? ` · ${cfg.bucket}` : "";
    return `${cfg.accessKeyId}@s3.${cfg.region}${bucket}`;
  },
  firstPage: "",
  optionalDeps: [
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "@aws-sdk/s3-request-presigner",
  ],
  capabilities: { browse: true, upload: true, health: true },
};
