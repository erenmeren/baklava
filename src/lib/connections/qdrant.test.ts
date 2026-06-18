import { describe, it, expect, vi, beforeEach } from "vitest";

const client = {
  getCollections: vi.fn(),
  getCollection: vi.fn(),
};
vi.mock("@qdrant/js-client-rest", () => ({
  // arrow functions cannot be used as constructors in this Vitest version;
  // use a regular function so `new QdrantClient(...)` works
  QdrantClient: vi.fn(function () { return client; }),
}));

import { probeQdrant, listCollections } from "./qdrant";

const cfg = { url: "http://localhost:6333" };

beforeEach(() => {
  client.getCollections.mockReset();
  client.getCollection.mockReset();
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
