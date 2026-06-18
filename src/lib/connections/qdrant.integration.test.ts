/**
 * Integration tests for the Qdrant driver. Gated by BAKLAVA_INTEGRATION=1
 * (the vitest.config.ts `integration` project only includes *.integration.test.*
 * files when that env var is set — plain `npm test` never sees this file).
 *
 * Additionally, each test is individually skipped with it.skipIf(!up) when
 * Qdrant is not reachable on the expected port, so a missing service gives a
 * clear skip rather than a confusing network error.
 *
 *   docker run -p 6333:6333 qdrant/qdrant
 *   BAKLAVA_INTEGRATION=1 npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { reachable } from "@/test/integration-helpers";

const URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const cfg = { url: URL };
const COLLECTION = "baklava_it_qdrant";

describe("qdrant driver", async () => {
  const up = await reachable("localhost", 6333);
  beforeAll(() => {
    if (!up) console.warn("[skip] qdrant not reachable on localhost:6333");
  });

  afterAll(async () => {
    if (!up) return;
    try {
      const { deleteCollection } = await import("./qdrant");
      await deleteCollection(cfg, COLLECTION);
    } catch {
      // best-effort cleanup — ignore errors if the collection was already removed
    }
  });

  it.skipIf(!up)("createCollection creates a 4-dim Cosine collection", async () => {
    const { createCollection } = await import("./qdrant");
    await createCollection(cfg, COLLECTION, { size: 4, distance: "Cosine" });
  });

  it.skipIf(!up)("upsertPoints inserts two points into the collection", async () => {
    const { upsertPoints } = await import("./qdrant");
    await upsertPoints(cfg, COLLECTION, [
      { id: 1, vector: [0.1, 0.2, 0.3, 0.4], payload: { tag: "a" } },
      { id: 2, vector: [0.9, 0.8, 0.7, 0.6], payload: { tag: "b" } },
    ]);
  });

  it.skipIf(!up)("listCollections includes the collection with correct vectorSize + distance", async () => {
    const { listCollections } = await import("./qdrant");
    const colls = await listCollections(cfg);
    const found = colls.find((c) => c.name === COLLECTION);
    expect(found).toBeDefined();
    expect(found!.vectorSize).toBe(4);
    expect(found!.distance).toBe("Cosine");
    expect(found!.pointsCount).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(!up)("scrollPoints returns both upserted points with 4-dim vectors", async () => {
    const { scrollPoints } = await import("./qdrant");
    const { points } = await scrollPoints(cfg, COLLECTION, { limit: 10, withVector: true });
    expect(points).toHaveLength(2);
    for (const p of points) {
      expect(Array.isArray(p.vector)).toBe(true);
      expect((p.vector as number[]).length).toBe(4);
    }
  });

  it.skipIf(!up)("searchPoints by pointId returns self as first hit (score ~1)", async () => {
    const { searchPoints } = await import("./qdrant");
    const hits = await searchPoints(cfg, COLLECTION, { pointId: 1, limit: 2 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe(1);
    expect(hits[0].score).toBeCloseTo(1, 1);
  });

  it.skipIf(!up)("deletePoints removes point id=2, leaving one point", async () => {
    const { deletePoints, scrollPoints } = await import("./qdrant");
    await deletePoints(cfg, COLLECTION, [2]);
    const { points } = await scrollPoints(cfg, COLLECTION, { limit: 10 });
    expect(points).toHaveLength(1);
    expect(points[0].id).toBe(1);
  });
});
