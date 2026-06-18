import { describe, it, expect, vi, beforeEach } from "vitest";

const client = {
  getCollections: vi.fn(),
  getCollection: vi.fn(),
  scroll: vi.fn(),
  search: vi.fn(),
  retrieve: vi.fn(),
  createCollection: vi.fn(),
  deleteCollection: vi.fn(),
  delete: vi.fn(),
};
vi.mock("@qdrant/js-client-rest", () => ({
  // arrow functions cannot be used as constructors in this Vitest version;
  // use a regular function so `new QdrantClient(...)` works
  QdrantClient: vi.fn(function () { return client; }),
}));

import { probeQdrant, listCollections, getCollection, scrollPoints, searchPoints, createCollection, deleteCollection, deletePoints } from "./qdrant";

const cfg = { url: "http://localhost:6333" };

beforeEach(() => {
  client.getCollections.mockReset();
  client.getCollection.mockReset();
  client.scroll.mockReset();
  client.search.mockReset();
  client.retrieve.mockReset();
  client.createCollection.mockReset();
  client.deleteCollection.mockReset();
  client.delete.mockReset();
});

describe("listCollections", () => {
  it("maps each collection's config to a summary", async () => {
    client.getCollections.mockResolvedValue({ collections: [{ name: "docs" }] });
    client.getCollection.mockResolvedValue({
      status: "green",
      points_count: 42,
      config: { params: { vectors: { size: 1536, distance: "Cosine" } } },
    });
    const out = await listCollections(cfg);
    expect(out).toEqual([
      { name: "docs", status: "green", pointsCount: 42, vectorSize: 1536, distance: "Cosine", namedVectors: [] },
    ]);
  });

  it("maps named vectors (size/distance from the first named vector)", async () => {
    client.getCollections.mockResolvedValue({ collections: [{ name: "multi" }] });
    client.getCollection.mockResolvedValue({
      status: "green",
      points_count: 3,
      config: { params: { vectors: { text: { size: 768, distance: "Cosine" }, image: { size: 512, distance: "Dot" } } } },
    });
    const out = await listCollections({ url: "http://localhost:6333" });
    expect(out[0]).toEqual({ name: "multi", status: "green", pointsCount: 3, vectorSize: 768, distance: "Cosine", namedVectors: ["text", "image"] });
  });
});

describe("probeQdrant", () => {
  it("returns the collection count", async () => {
    client.getCollections.mockResolvedValue({ collections: [{ name: "a" }, { name: "b" }] });
    expect(await probeQdrant(cfg)).toEqual({ collectionCount: 2 });
  });
});

describe("getCollection", () => {
  it("returns config + stats", async () => {
    client.getCollection.mockResolvedValue({
      status: "green", points_count: 10,
      config: { params: { vectors: { size: 4, distance: "Dot" } } },
      payload_schema: { title: { data_type: "keyword" } },
    });
    const out = await getCollection({ url: "http://localhost:6333" }, "docs");
    expect(out.pointsCount).toBe(10);
    expect(out.vectors).toEqual({ size: 4, distance: "Dot", named: [] });
    expect(out.payloadSchema).toEqual({ title: { data_type: "keyword" } });
  });
});

describe("scrollPoints", () => {
  it("returns points + nextOffset", async () => {
    client.scroll.mockResolvedValue({
      points: [{ id: 1, payload: { t: "a" }, vector: [0.1, 0.2] }],
      next_page_offset: 2,
    });
    const out = await scrollPoints({ url: "http://localhost:6333" }, "docs", { limit: 1, withVector: true });
    expect(out.points[0]).toEqual({ id: 1, payload: { t: "a" }, vector: [0.1, 0.2] });
    expect(out.nextOffset).toBe(2);
    expect(client.scroll).toHaveBeenCalledWith("docs", expect.objectContaining({ limit: 1, with_payload: true, with_vector: true }));
  });
});

describe("searchPoints", () => {
  it("searches by a raw vector", async () => {
    client.search.mockResolvedValue([{ id: 1, score: 0.9, payload: { t: "a" } }]);
    const out = await searchPoints({ url: "http://localhost:6333" }, "docs", { vector: [0.1, 0.2], limit: 5 });
    expect(out).toEqual([{ id: 1, score: 0.9, payload: { t: "a" } }]);
    expect(client.search).toHaveBeenCalledWith("docs", expect.objectContaining({ vector: [0.1, 0.2], limit: 5, with_payload: true }));
  });
  it("by pointId: retrieves the point's vector then searches", async () => {
    client.retrieve.mockResolvedValue([{ id: 7, vector: [1, 2, 3] }]);
    client.search.mockResolvedValue([{ id: 8, score: 0.8, payload: {} }]);
    const out = await searchPoints({ url: "http://localhost:6333" }, "docs", { pointId: 7, limit: 3 });
    expect(client.retrieve).toHaveBeenCalledWith("docs", expect.objectContaining({ ids: [7], with_vector: true }));
    expect(client.search).toHaveBeenCalledWith("docs", expect.objectContaining({ vector: [1, 2, 3], limit: 3 }));
    expect(out[0].id).toBe(8);
  });
});

describe("mutations", () => {
  it("createCollection passes size + distance", async () => {
    await createCollection({ url: "http://localhost:6333" }, "new", { size: 128, distance: "Cosine" });
    expect(client.createCollection).toHaveBeenCalledWith("new", { vectors: { size: 128, distance: "Cosine" } });
  });
  it("deleteCollection + deletePoints delegate", async () => {
    await deleteCollection({ url: "http://localhost:6333" }, "new");
    await deletePoints({ url: "http://localhost:6333" }, "docs", [1, 2]);
    expect(client.deleteCollection).toHaveBeenCalledWith("new");
    expect(client.delete).toHaveBeenCalledWith("docs", { points: [1, 2] });
  });
});
