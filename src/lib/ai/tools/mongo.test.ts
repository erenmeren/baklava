import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/mongo", () => ({
  parseEjson: (s: string) => JSON.parse(s),
  listDatabases: vi.fn(async () => [{ name: "app" }]),
  listCollections: vi.fn(async () => [{ name: "orders" }]),
  findDocuments: vi.fn(async () => ({ documents: ["{}"], total: 1, skip: 0, limit: 50 })),
  runAggregate: vi.fn(async () => ({ documents: [], truncated: false })),
  sampleSchema: vi.fn(async () => ({ sampleSize: 1, fields: [] })),
  listIndexes: vi.fn(async () => []),
  insertDocument: vi.fn(async () => ({ insertedId: "1" })),
  replaceDocument: vi.fn(async () => ({ matched: 1, modified: 1 })),
  createIndex: vi.fn(async () => ({ name: "ix" })),
  createCollectionOp: vi.fn(async () => undefined),
  deleteDocument: vi.fn(async () => ({ deleted: 1 })),
  dropCollectionOp: vi.fn(async () => undefined),
  dropIndex: vi.fn(async () => undefined),
}));

import * as mo from "@/lib/connections/mongo";
import { mongoTools } from "./mongo";

const cfg = { uri: "mongodb://h" };
const tools = () => mongoTools("c1", cfg as never);

describe("mongoTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tags categories", () => {
    const m = Object.fromEntries(tools().map((t) => [t.name, t.category]));
    expect(m["mongo_find"]).toBe("read");
    expect(m["mongo_aggregate"]).toBe("read");
    expect(m["mongo_insert_document"]).toBe("write");
    expect(m["mongo_delete_document"]).toBe("destructive");
    expect(m["mongo_drop_collection"]).toBe("destructive");
  });

  it("mongo_find delegates with parsed options", async () => {
    const t = tools().find((x) => x.name === "mongo_find")!;
    await t.execute({ database: "app", collection: "orders", filter: '{"a":1}' });
    expect(mo.findDocuments).toHaveBeenCalledWith("c1", cfg, "app", "orders", expect.objectContaining({ filter: '{"a":1}' }));
  });

  it("mongo_aggregate rejects a $out stage without calling the driver", async () => {
    const t = tools().find((x) => x.name === "mongo_aggregate")!;
    await expect(
      t.execute({ database: "app", collection: "orders", pipeline: '[{"$out":"dump"}]' }),
    ).rejects.toThrow(/\$out|\$merge|read-only/i);
    expect(mo.runAggregate).not.toHaveBeenCalled();
  });

  it("mongo_aggregate rejects a $merge stage", async () => {
    const t = tools().find((x) => x.name === "mongo_aggregate")!;
    await expect(
      t.execute({ database: "app", collection: "orders", pipeline: '[{"$merge":{"into":"x"}}]' }),
    ).rejects.toThrow(/\$out|\$merge|read-only/i);
    expect(mo.runAggregate).not.toHaveBeenCalled();
  });

  it("mongo_aggregate runs a normal pipeline", async () => {
    const t = tools().find((x) => x.name === "mongo_aggregate")!;
    await t.execute({ database: "app", collection: "orders", pipeline: '[{"$match":{"a":1}}]' });
    expect(mo.runAggregate).toHaveBeenCalledWith("c1", cfg, "app", "orders", '[{"$match":{"a":1}}]');
  });

  it("mongo_drop_collection delegates", async () => {
    const t = tools().find((x) => x.name === "mongo_drop_collection")!;
    await t.execute({ database: "app", collection: "orders" });
    expect(mo.dropCollectionOp).toHaveBeenCalledWith("c1", cfg, "app", "orders");
  });
});
