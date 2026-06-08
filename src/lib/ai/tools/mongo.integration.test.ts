/**
 * Integration test: drives the actual AI `mongo_*` tools against a real MongoDB.
 * Gated by BAKLAVA_INTEGRATION=1; self-skips if Mongo isn't on localhost:27017.
 *
 *   docker run -d --name mongo -p 27017:27017 mongo:7
 *   BAKLAVA_INTEGRATION=1 npx vitest run src/lib/ai/tools/mongo.integration.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { reachable } from "@/test/integration-helpers";
import { mongoTools } from "./mongo";
import type { AiTool } from "./types";

const cfg = { uri: process.env.BAKLAVA_MONGO_URI ?? "mongodb://localhost:27017" };
const tools = mongoTools("integration-conn", cfg as never);
const tool = (name: string): AiTool => tools.find((t) => t.name === name)!;

const DB = "integration_ai";
const COLL = "items";

describe("mongo tools against real MongoDB", async () => {
  const up = await reachable("localhost", 27017);
  beforeAll(() => {
    if (!up) console.warn("[skip] mongo not reachable on localhost:27017");
  });

  it.skipIf(!up)("insert → find → aggregate round-trip", async () => {
    await tool("mongo_insert_document").execute({
      database: DB,
      collection: COLL,
      document: '{"name":"widget","qty":3}',
    });

    const found = await tool("mongo_find").execute({
      database: DB,
      collection: COLL,
      filter: '{"name":"widget"}',
    });
    expect(JSON.stringify(found)).toContain("widget");

    const agg = await tool("mongo_aggregate").execute({
      database: DB,
      collection: COLL,
      pipeline: '[{"$match":{"qty":3}}]',
    });
    expect(JSON.stringify(agg)).toContain("widget");

    await tool("mongo_delete_document").execute({ database: DB, collection: COLL, filter: '{"name":"widget"}' });
    await tool("mongo_drop_collection").execute({ database: DB, collection: COLL });
  }, 20000);

  it.skipIf(!up)("aggregate REJECTS $out / $merge and never writes the target collection", async () => {
    await expect(
      tool("mongo_aggregate").execute({ database: DB, collection: COLL, pipeline: '[{"$out":"evil_out"}]' }),
    ).rejects.toThrow(/\$out|\$merge|read-only/i);

    await expect(
      tool("mongo_aggregate").execute({
        database: DB,
        collection: COLL,
        pipeline: '[{"$merge":{"into":"evil_merge"}}]',
      }),
    ).rejects.toThrow(/\$out|\$merge|read-only/i);

    // The guard fires before the driver, so neither target collection exists.
    const colls = await tool("mongo_list_collections").execute({ database: DB });
    const names = JSON.stringify(colls);
    expect(names).not.toContain("evil_out");
    expect(names).not.toContain("evil_merge");
  }, 20000);
});
