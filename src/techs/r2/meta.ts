import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import { blobProvider } from "@/lib/command-palette/infra-providers";
import type { R2Config, ConnectionRecord } from "@/lib/connections/types";

const schema = z.object({
  accountId: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  bucket: z.string().optional(),
});

export const r2Meta: TechModuleMeta<R2Config> = {
  id: "r2",
  catalog: {
    id: "r2",
    name: "Cloudflare R2",
    tagline: "Object storage",
    description:
      "S3-style object browser: buckets, prefix navigation, upload/download, presigned links, CORS and lifecycle.",
    category: "Storage",
    color: "from-orange-400 to-amber-500",
    status: "available",
  },
  config: {
    schema: schema as unknown as z.ZodType<R2Config>,
    secretKeys: ["secretAccessKey"],
  },
  summary: (r: ConnectionRecord) => {
    const cfg = r.config as R2Config;
    const bucket = cfg.bucket ? ` · ${cfg.bucket}` : "";
    return `${cfg.accessKeyId}@${cfg.accountId}.r2${bucket}`;
  },
  firstPage: "",
  optionalDeps: [
    "@aws-sdk/client-s3",
    "@aws-sdk/lib-storage",
    "@aws-sdk/s3-request-presigner",
  ],
  commandObjects: blobProvider("r2"),
  capabilities: { browse: true, upload: true, health: true },
};
