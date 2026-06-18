import "server-only";
import type { QdrantClient } from "@qdrant/js-client-rest"; // type-only — erased
import type { QdrantConfig } from "./types";
import { DriverNotInstalledError } from "@/techs/contract";

let mod: typeof import("@qdrant/js-client-rest") | null = null;
async function getQdrant(): Promise<typeof import("@qdrant/js-client-rest")> {
  try {
    return (mod ??= await import("@qdrant/js-client-rest"));
  } catch {
    throw new DriverNotInstalledError("qdrant", "@qdrant/js-client-rest");
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

export interface CollectionDetail {
  status: string;
  pointsCount: number;
  vectors: { size: number | null; distance: string | null; named: string[] };
  payloadSchema: Record<string, unknown>;
}

export async function getCollection(cfg: QdrantConfig, name: string): Promise<CollectionDetail> {
  return withClient(cfg, async (c) => {
    const info = await c.getCollection(name);
    return {
      status: String(info.status ?? "unknown"),
      pointsCount: info.points_count ?? 0,
      vectors: vectorParams(info.config?.params?.vectors),
      payloadSchema: (info.payload_schema as Record<string, unknown>) ?? {},
    };
  });
}

export interface QdrantPoint { id: string | number; payload: Record<string, unknown> | null; vector?: number[] | Record<string, number[]> }

/** Loose escape-valve type for the REST client — avoids fighting narrow SDK generics. */
type AnyClient = Record<string, (...args: unknown[]) => Promise<unknown>>;

export async function scrollPoints(
  cfg: QdrantConfig,
  name: string,
  opts: { limit: number; offset?: string | number; filter?: unknown; withVector?: boolean },
): Promise<{ points: QdrantPoint[]; nextOffset: string | number | null }> {
  return withClient(cfg, async (c) => {
    const res = await (c as unknown as AnyClient).scroll(name, {
      limit: opts.limit,
      offset: opts.offset,
      filter: opts.filter,
      with_payload: true,
      with_vector: opts.withVector ?? false,
    }) as { points: QdrantPoint[]; next_page_offset?: string | number | null };
    return {
      points: (res.points ?? []) as QdrantPoint[],
      nextOffset: (res.next_page_offset as string | number | null) ?? null,
    };
  });
}

export interface SearchHit { id: string | number; score: number; payload: Record<string, unknown> | null }

export async function searchPoints(
  cfg: QdrantConfig,
  name: string,
  opts: { vector?: number[]; pointId?: string | number; vectorName?: string; limit: number; filter?: unknown },
): Promise<SearchHit[]> {
  return withClient(cfg, async (c) => {
    const ac = c as unknown as AnyClient;
    let vector = opts.vector;
    if (vector === undefined && opts.pointId !== undefined) {
      const got = await ac.retrieve(name, { ids: [opts.pointId], with_vector: true }) as Array<{ id: string | number; vector?: unknown }>;
      const v = got[0]?.vector;
      vector = (opts.vectorName && v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, number[]>)[opts.vectorName]
        : (v as number[])) ?? undefined;
      if (!vector) throw new Error(`Point ${opts.pointId} has no vector to search by`);
    }
    if (!vector) throw new Error("A query vector or pointId is required");
    const res = await ac.search(name, {
      vector: opts.vectorName ? { name: opts.vectorName, vector } : vector,
      limit: opts.limit,
      filter: opts.filter,
      with_payload: true,
    }) as Array<{ id: string | number; score: number; payload?: unknown }>;
    return (res ?? []).map((h) => ({ id: h.id, score: h.score, payload: (h.payload as Record<string, unknown>) ?? null }));
  });
}

export async function createCollection(cfg: QdrantConfig, name: string, opts: { size: number; distance: string }): Promise<void> {
  await withClient(cfg, (c) =>
    (c as unknown as AnyClient).createCollection(name, { vectors: { size: opts.size, distance: opts.distance } }),
  );
}

export async function deleteCollection(cfg: QdrantConfig, name: string): Promise<void> {
  await withClient(cfg, (c) => (c as unknown as AnyClient).deleteCollection(name));
}

export async function deletePoints(cfg: QdrantConfig, name: string, ids: (string | number)[]): Promise<void> {
  await withClient(cfg, (c) => (c as unknown as AnyClient).delete(name, { points: ids }));
}
