import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import type { MinioConfig, ConnectionRecord } from "@/lib/connections/types";

const schema = z.object({
  endpoint: z.string(),
  useSSL: z.boolean(),
  accessKey: z.string(),
  secretKey: z.string(),
  region: z.string(),
  bucket: z.string().optional(),
});

export const minioMeta: TechModuleMeta<MinioConfig> = {
  id: "minio",
  catalog: {
    id: "minio",
    name: "MinIO",
    tagline: "S3-compatible object storage",
    description:
      "Self-hosted S3 object browser: buckets, prefix navigation, upload/download, presigned links, CORS and lifecycle.",
    category: "Storage",
    color: "from-red-400 to-rose-600",
    status: "available",
  },
  config: {
    schema: schema as unknown as z.ZodType<MinioConfig>,
    secretKeys: ["secretKey"],
  },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as MinioConfig;
    const bucket = cfg.bucket ? ` · ${cfg.bucket}` : "";
    return `${cfg.accessKey}@${cfg.endpoint}${bucket}`;
  },
  firstPage: "",
  optionalDeps: [
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "@aws-sdk/s3-request-presigner",
  ],
  capabilities: { browse: true, upload: true, health: true },
};
