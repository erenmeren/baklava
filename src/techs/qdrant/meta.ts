import { z } from "zod";
import type { TechModuleMeta } from "@/techs/contract";
import type { QdrantConfig, ConnectionRecord } from "@/lib/connections/types";

const schema = z.object({ url: z.string(), apiKey: z.string().optional() });

export const qdrantMeta: TechModuleMeta<QdrantConfig> = {
  id: "qdrant",
  catalog: {
    id: "qdrant",
    name: "Qdrant",
    tagline: "Vector database",
    description: "Browse collections and points, run similarity search, and manage vectors.",
    category: "Vector",
    color: "from-rose-400 to-pink-600",
    status: "available",
  },
  config: { schema: schema as unknown as z.ZodType<QdrantConfig>, secretKeys: ["apiKey"] },
  summary: (r: ConnectionRecord) => {
    const url = (r.config as QdrantConfig).url ?? "";
    try { return new URL(url).host; } catch { return url; }
  },
  firstPage: "collections",
  optionalDeps: ["@qdrant/js-client-rest"],
  capabilities: { browse: true, query: true, objectExplorer: true, vectorSearch: true, health: true },
};
