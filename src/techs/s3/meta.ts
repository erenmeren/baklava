import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import { blobProvider } from "@/lib/command-palette/infra-providers";
import type { S3Config, ConnectionRecord } from "@/lib/connections/types";

const schema = z.object({
  region: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  sessionToken: z.string().optional(),
  bucket: z.string().optional(),
});

export const s3Meta: TechModuleMeta<S3Config> = {
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
  commandObjects: blobProvider("s3"),
  capabilities: { browse: true, upload: true, health: true },
};
