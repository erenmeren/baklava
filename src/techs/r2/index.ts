import { z } from "zod";
import type { TechModule } from "@/techs/contract";
import type { R2Config, ConnectionRecord } from "@/lib/connections/types";
import { r2ClientFor, dropR2Client } from "@/lib/connections/r2";
import { probe as s3Probe } from "@/lib/connections/s3";

const schema = z.object({
  accountId: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  bucket: z.string().optional(),
});

export const r2: TechModule<R2Config> = {
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
  driver: {
    probe: async (c: R2Config) => {
      const id = `__probe_${Math.random().toString(36).slice(2)}`;
      const client = r2ClientFor(id, c);
      try {
        return await s3Probe(client);
      } finally {
        dropR2Client(id);
      }
    },
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
  capabilities: { browse: true, upload: true, health: true },
};
