import "server-only";
import type { QdrantClient } from "@qdrant/js-client-rest"; // type-only — erased
import type { QdrantConfig } from "./types";
import { DriverNotInstalledError } from "@/techs/contract";
import type { TechId } from "./types";

let mod: typeof import("@qdrant/js-client-rest") | null = null;
async function getQdrant(): Promise<typeof import("@qdrant/js-client-rest")> {
  try {
    return (mod ??= await import("@qdrant/js-client-rest"));
  } catch {
    // "qdrant" will be added to TechId in a follow-up task; cast until then
    throw new DriverNotInstalledError("qdrant" as TechId, "@qdrant/js-client-rest");
  }
}

async function withClient<T>(cfg: QdrantConfig, fn: (c: QdrantClient) => Promise<T>): Promise<T> {
  const { QdrantClient } = await getQdrant();
  const client = new QdrantClient({ url: cfg.url, apiKey: cfg.apiKey || undefined });
  // REST client — stateless HTTP, no explicit disconnect needed.
  return fn(client);
}

export interface CollectionSummary {
  name: string;
  status: string;
  pointsCount: number;
  vectorSize: number | null;
  distance: string | null;
  namedVectors: string[];
}

/** Pull size/distance/namedVectors out of a getCollection() vectors config,
 *  which is either { size, distance } or { [name]: { size, distance } }. */
function vectorParams(vectors: unknown): { size: number | null; distance: string | null; named: string[] } {
  if (vectors && typeof vectors === "object") {
    const v = vectors as Record<string, unknown>;
    if (typeof v.size === "number") {
      return { size: v.size as number, distance: (v.distance as string) ?? null, named: [] };
    }
    const names = Object.keys(v);
    if (names.length) {
      const first = v[names[0]] as { size?: number; distance?: string };
      return { size: first?.size ?? null, distance: first?.distance ?? null, named: names };
    }
  }
  return { size: null, distance: null, named: [] };
}

export async function listCollections(cfg: QdrantConfig): Promise<CollectionSummary[]> {
  return withClient(cfg, async (c) => {
    const { collections } = await c.getCollections();
    return Promise.all(
      collections.map(async ({ name }) => {
        const info = await c.getCollection(name);
        const { size, distance, named } = vectorParams(info.config?.params?.vectors);
        return {
          name,
          status: String(info.status ?? "unknown"),
          pointsCount: info.points_count ?? 0,
          vectorSize: size,
          distance,
          namedVectors: named,
        };
      }),
    );
  });
}

export async function probeQdrant(cfg: QdrantConfig): Promise<{ collectionCount: number }> {
  return withClient(cfg, async (c) => {
    const { collections } = await c.getCollections();
    return { collectionCount: collections.length };
  });
}
