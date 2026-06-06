# AI Tools — Phase 2 (Mongo, Redis, Kafka, Kubernetes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full read/write/destructive AI tools for MongoDB, Redis, Kafka, and Kubernetes, bringing AI coverage to all 8 techs, with a per-connection "reveal K8s secret values" toggle (default off).

**Architecture:** Four new tool modules of category-tagged thin wrappers over existing drivers; two new Kubernetes driver helpers (one-shot logs + delete) and a redaction option on `readResourceYaml`; a new `PermissionPolicy.allowK8sSecretValues` flag threaded through a widened registry `Builder` signature. Gate/permissions/addressing/persistence otherwise unchanged.

**Tech Stack:** TypeScript, Vitest, `mongodb`/`bson`, `ioredis`, `kafkajs`, `@kubernetes/client-node`, `zod`. Reuses `src/lib/ai/tools/types.ts` (`AiTool`), `registry.ts`, `supported.ts`, `permissions.ts`.

**Spec:** `docs/superpowers/specs/2026-06-06-ai-tools-phase2-design.md`
**Branch:** continue on `feat/ai-tools-phase2`.

---

## File Structure

- **Modify:** `src/lib/connections/kubernetes.ts` (+`getPodLogs`, +`deleteResource`, redact opt on `readResourceYaml`), `src/lib/ai/permissions.ts` (+`allowK8sSecretValues`), `src/lib/ai/tools/registry.ts` (Builder widening + 4 BUILDERS entries), `src/lib/ai/supported.ts` (all 8), `src/app/api/ai/connections/[id]/policy/route.ts` (persist flag), `src/components/ai/working-set.tsx` + `src/app/assistant/assistant-client.tsx` (secret toggle UI).
- **Create:** `src/lib/ai/tools/{mongo,redis,kafka,kubernetes}.ts` + matching `*.test.ts`.

---

## Task 1: Kubernetes driver helpers

**Files:** Modify `src/lib/connections/kubernetes.ts`.

Existing: private `bundleFor(connectionId, cfg)` → `{ kc, core, apps, version, objects }`; `Log` imported from `@kubernetes/client-node`; `PassThrough` from `node:stream`; `resolveKind(kind)` → `{ apiVersion, kind, namespaced }`; `readResourceYaml(connectionId, cfg, kind, namespace, name)`; `sanitizeForEdit` private; `dumpYaml` imported.

- [ ] **Step 1: Add `getPodLogs` (one-shot, bounded)** after `streamPodLogs`:
```ts
/** One-shot, non-following pod logs (tail-bounded, byte-capped) for the AI tool. */
export async function getPodLogs(
  connectionId: string,
  cfg: KubernetesConfig,
  namespace: string,
  podName: string,
  opts: { tailLines?: number; container?: string } = {},
): Promise<string> {
  const b = bundleFor(connectionId, cfg);
  const log = new Log(b.kc);
  const output = new PassThrough();
  const MAX_BYTES = 200_000;
  const chunks: Buffer[] = [];
  let total = 0;
  return new Promise<string>((resolve, reject) => {
    output.on("data", (c: Buffer) => {
      if (total < MAX_BYTES) { chunks.push(c); total += c.length; }
    });
    output.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").slice(0, MAX_BYTES)));
    output.on("error", reject);
    log
      .log(namespace, podName, opts.container ?? "", output, {
        follow: false,
        tailLines: Math.min(Math.max(opts.tailLines ?? 200, 1), 2000),
        timestamps: false,
        pretty: false,
      })
      .catch(reject);
  });
}
```

- [ ] **Step 2: Add `deleteResource`** after `replaceResourceYaml`:
```ts
export async function deleteResource(
  connectionId: string,
  cfg: KubernetesConfig,
  kind: string,
  namespace: string | undefined,
  name: string,
): Promise<void> {
  const b = bundleFor(connectionId, cfg);
  const k = resolveKind(kind);
  await b.objects.delete({
    apiVersion: k.apiVersion,
    kind: k.kind,
    metadata: { name, namespace: k.namespaced ? namespace : undefined },
  });
}
```

- [ ] **Step 3: Add a redaction option to `readResourceYaml`.** Change its signature to accept `opts?: { redactSecretValues?: boolean }` and, when redacting a Secret, strip `data`/`stringData` before `dumpYaml`. Read the current function; modify it so the body becomes:
```ts
export async function readResourceYaml(
  connectionId: string,
  cfg: KubernetesConfig,
  kind: string,
  namespace: string | undefined,
  name: string,
  opts: { redactSecretValues?: boolean } = {},
): Promise<string> {
  const b = bundleFor(connectionId, cfg);
  const k = resolveKind(kind);
  const spec = {
    apiVersion: k.apiVersion,
    kind: k.kind,
    metadata: { name, namespace: k.namespaced ? namespace : undefined },
  };
  const obj = await b.objects.read(spec);
  const clean = sanitizeForEdit(obj) as Record<string, unknown>;
  if (opts.redactSecretValues && k.kind === "Secret") {
    delete clean.data;
    delete clean.stringData;
  }
  return dumpYaml(clean);
}
```
(Existing callers pass no `opts`, so behavior is unchanged for them.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck` — expect PASS.
Testing note: these three touch a live cluster / the mock-cluster harness; no unit test added (repo convention for the K8s driver). Exercised manually in Task 10.

- [ ] **Step 5: Commit**
```bash
git add src/lib/connections/kubernetes.ts
git commit -m "feat(k8s): getPodLogs + deleteResource + readResourceYaml secret redaction"
```

---

## Task 2: PermissionPolicy gains allowK8sSecretValues

**Files:** Modify `src/lib/ai/permissions.ts`; Test `src/lib/ai/permissions.test.ts`.

- [ ] **Step 1: Add a failing test** — append to `src/lib/ai/permissions.test.ts`:
```ts
describe("allowK8sSecretValues", () => {
  it("is absent (falsy) on the default policy", () => {
    expect(DEFAULT_POLICY.allowK8sSecretValues).toBeUndefined();
  });
  it("is an accepted optional field", () => {
    const p: PermissionPolicy = { ...DEFAULT_POLICY, allowK8sSecretValues: true };
    expect(p.allowK8sSecretValues).toBe(true);
  });
});
```
(`DEFAULT_POLICY`, `PermissionPolicy` are already imported in that file.)

- [ ] **Step 2: Run** `npm test -- src/lib/ai/permissions.test.ts` — expect FAIL (type error / field unknown).

- [ ] **Step 3: Implement** — in `src/lib/ai/permissions.ts`, add the optional field to the `PermissionPolicy` interface:
```ts
  /**
   * Kubernetes only: when true, k8s_get_yaml returns Secret values verbatim.
   * Default (false/undefined) redacts Secret data/stringData. Not a category —
   * isAllowed/needsApproval ignore it.
   */
  allowK8sSecretValues?: boolean;
```

- [ ] **Step 4: Run** `npm test -- src/lib/ai/permissions.test.ts` — expect PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/ai/permissions.ts src/lib/ai/permissions.test.ts
git commit -m "feat(ai): PermissionPolicy.allowK8sSecretValues flag"
```

---

## Task 3: Widen the registry Builder to receive policy

**Files:** Modify `src/lib/ai/tools/registry.ts`.

The K8s tool builder needs the connection's policy (for the secret flag). `buildTools` already receives `policy`; pass it to the builder. Existing `(id, cfg)` builders remain assignable to the widened type (extra param ignored).

- [ ] **Step 1: Read `src/lib/ai/tools/registry.ts`.** Change the `Builder` type and the `buildTools` invocation:
```ts
import type { PermissionPolicy } from "../permissions";
// …
type Builder = (connectionId: string, config: unknown, policy: PermissionPolicy) => AiTool[];
// …in buildTools, change the builder call to pass policy:
  return builder(connectionId, config, policy).filter((t) => isAllowed(t.category, policy));
```
Leave the existing `postgres`/`docker`/`mysql`/`sqlserver` entries as-is (their `(id, cfg) =>` arrows are still assignable).

- [ ] **Step 2: Verify**

Run: `npm test -- src/lib/ai/tools/registry.test.ts` — expect PASS (unchanged behavior).
Run: `npm run typecheck` — expect PASS.

- [ ] **Step 3: Commit**
```bash
git add src/lib/ai/tools/registry.ts
git commit -m "refactor(ai): registry Builder receives the connection policy"
```

---

## Task 4: Mongo tools

**Files:** Create `src/lib/ai/tools/mongo.ts`; Test `src/lib/ai/tools/mongo.test.ts`.

Driver (connectionId-first): `listDatabases(id,cfg)`, `listCollections(id,cfg,db)`, `findDocuments(id,cfg,db,coll,options:{filter,projection,sort,skip,limit})`, `runAggregate(id,cfg,db,coll,pipelineEjson)`, `sampleSchema(id,cfg,db,coll,sampleSize?)`, `listIndexes(id,cfg,db,coll)`, `insertDocument(id,cfg,db,coll,ejson)`, `replaceDocument(id,cfg,db,coll,filterEjson,docEjson)`, `createIndex(id,cfg,db,coll,{keysEjson,options?})`, `createCollectionOp(id,cfg,db,{name,…})`, `deleteDocument(id,cfg,db,coll,filterEjson)`, `dropCollectionOp(id,cfg,db,coll)`, `dropIndex(id,cfg,db,coll,indexName)`, plus `parseEjson<T>(s)`.

- [ ] **Step 1: Write the failing test** — create `src/lib/ai/tools/mongo.test.ts`:
```ts
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
const tools = () => mongoTools("c1", cfg);

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
    const out = await t.execute({ database: "app", collection: "orders", pipeline: '[{"$out":"dump"}]' });
    expect(mo.runAggregate).not.toHaveBeenCalled();
    expect(out).toMatchObject({ error: expect.stringMatching(/\$out|\$merge|read-only/i) });
  });

  it("mongo_aggregate rejects a $merge stage", async () => {
    const t = tools().find((x) => x.name === "mongo_aggregate")!;
    const out = await t.execute({ database: "app", collection: "orders", pipeline: '[{"$merge":{"into":"x"}}]' });
    expect(mo.runAggregate).not.toHaveBeenCalled();
    expect(out).toMatchObject({ error: expect.any(String) });
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
```

- [ ] **Step 2: Run** `npm test -- src/lib/ai/tools/mongo.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** — create `src/lib/ai/tools/mongo.ts`:
```ts
import { z } from "zod";
import type { MongoConfig } from "@/lib/connections/types";
import {
  parseEjson,
  listDatabases,
  listCollections,
  findDocuments,
  runAggregate,
  sampleSchema,
  listIndexes,
  insertDocument,
  replaceDocument,
  createIndex,
  createCollectionOp,
  deleteDocument,
  dropCollectionOp,
  dropIndex,
} from "@/lib/connections/mongo";
import type { AiTool } from "./types";

export function mongoTools(connectionId: string, config: MongoConfig): AiTool[] {
  const ns = z.object({ database: z.string(), collection: z.string() });
  return [
    {
      name: "mongo_list_databases",
      description: "List databases on this MongoDB server.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listDatabases(connectionId, config),
    },
    {
      name: "mongo_list_collections",
      description: "List collections in a database with stats.",
      category: "read",
      inputSchema: z.object({ database: z.string() }),
      execute: async ({ database }) => listCollections(connectionId, config, database as string),
    },
    {
      name: "mongo_find",
      description: "Find documents. filter/projection/sort are extended-JSON (EJSON) strings.",
      category: "read",
      inputSchema: ns.extend({
        filter: z.string().optional(),
        projection: z.string().optional(),
        sort: z.string().optional(),
        skip: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: async ({ database, collection, filter, projection, sort, skip, limit }) =>
        findDocuments(connectionId, config, database as string, collection as string, {
          filter: filter as string | undefined,
          projection: projection as string | undefined,
          sort: sort as string | undefined,
          skip: skip as number | undefined,
          limit: limit as number | undefined,
        }),
    },
    {
      name: "mongo_aggregate",
      description:
        "Run a READ-ONLY aggregation pipeline (EJSON array of stages) and return documents. Pipelines that write ($out/$merge) are rejected.",
      category: "read",
      inputSchema: ns.extend({ pipeline: z.string() }),
      execute: async ({ database, collection, pipeline }) => {
        let stages: unknown;
        try {
          stages = parseEjson<unknown>(pipeline as string);
        } catch (e) {
          return { error: `Invalid pipeline EJSON: ${e instanceof Error ? e.message : String(e)}` };
        }
        if (!Array.isArray(stages)) return { error: "Pipeline must be a JSON array of stages." };
        const writes = stages.some(
          (s) => s && typeof s === "object" && ("$out" in (s as object) || "$merge" in (s as object)),
        );
        if (writes) return { error: "aggregate is read-only: $out / $merge stages are not allowed." };
        return runAggregate(connectionId, config, database as string, collection as string, pipeline as string);
      },
    },
    {
      name: "mongo_sample_schema",
      description: "Infer the collection's field shape by sampling documents.",
      category: "read",
      inputSchema: ns.extend({ sampleSize: z.number().int().min(10).max(5000).optional() }),
      execute: async ({ database, collection, sampleSize }) =>
        sampleSchema(connectionId, config, database as string, collection as string, sampleSize as number | undefined),
    },
    {
      name: "mongo_list_indexes",
      description: "List a collection's indexes.",
      category: "read",
      inputSchema: ns,
      execute: async ({ database, collection }) =>
        listIndexes(connectionId, config, database as string, collection as string),
    },
    {
      name: "mongo_insert_document",
      description: "Insert one document (EJSON string).",
      category: "write",
      inputSchema: ns.extend({ document: z.string() }),
      execute: async ({ database, collection, document }) =>
        insertDocument(connectionId, config, database as string, collection as string, document as string),
    },
    {
      name: "mongo_replace_document",
      description: "Replace one document matching the filter (both EJSON strings).",
      category: "write",
      inputSchema: ns.extend({ filter: z.string(), document: z.string() }),
      execute: async ({ database, collection, filter, document }) =>
        replaceDocument(connectionId, config, database as string, collection as string, filter as string, document as string),
    },
    {
      name: "mongo_create_index",
      description: "Create an index. keys is an EJSON object like {\"field\":1}.",
      category: "write",
      inputSchema: ns.extend({
        keys: z.string(),
        name: z.string().optional(),
        unique: z.boolean().optional(),
      }),
      execute: async ({ database, collection, keys, name, unique }) =>
        createIndex(connectionId, config, database as string, collection as string, {
          keysEjson: keys as string,
          options: { name: name as string | undefined, unique: unique as boolean | undefined },
        }),
    },
    {
      name: "mongo_create_collection",
      description: "Create a new collection.",
      category: "write",
      inputSchema: z.object({ database: z.string(), name: z.string() }),
      execute: async ({ database, name }) => {
        await createCollectionOp(connectionId, config, database as string, { name: name as string });
        return { ok: true, created: `${database}.${name}` };
      },
    },
    {
      name: "mongo_delete_document",
      description: "Delete ONE document matching the filter (EJSON). DESTRUCTIVE.",
      category: "destructive",
      inputSchema: ns.extend({ filter: z.string() }),
      execute: async ({ database, collection, filter }) =>
        deleteDocument(connectionId, config, database as string, collection as string, filter as string),
    },
    {
      name: "mongo_drop_collection",
      description: "Drop (delete) a collection. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: ns,
      execute: async ({ database, collection }) => {
        await dropCollectionOp(connectionId, config, database as string, collection as string);
        return { ok: true, dropped: `${database}.${collection}` };
      },
    },
    {
      name: "mongo_drop_index",
      description: "Drop an index by name. DESTRUCTIVE.",
      category: "destructive",
      inputSchema: ns.extend({ indexName: z.string() }),
      execute: async ({ database, collection, indexName }) => {
        await dropIndex(connectionId, config, database as string, collection as string, indexName as string);
        return { ok: true, dropped: indexName };
      },
    },
  ];
}
```

- [ ] **Step 4: Run** `npm test -- src/lib/ai/tools/mongo.test.ts` — expect PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expect PASS.
```bash
git add src/lib/ai/tools/mongo.ts src/lib/ai/tools/mongo.test.ts
git commit -m "feat(ai): mongo tools (aggregate guards $out/$merge)"
```

---

## Task 5: Redis tools

**Files:** Create `src/lib/ai/tools/redis.ts`; Test `src/lib/ai/tools/redis.test.ts`.

Driver (connectionId-first): `info(id,cfg,section?)`, `listKeys(id,cfg,{pattern?,db?})`, `getKey(id,cfg,key,db?)`, `setStringValue(id,cfg,key,value,db?)`, `setTtl(id,cfg,key,ttlSeconds,db?)`, `delKey(id,cfg,key,db?)`.

- [ ] **Step 1: Write the failing test** — create `src/lib/ai/tools/redis.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/redis", () => ({
  info: vi.fn(async () => ({ server: {} })),
  listKeys: vi.fn(async () => ({ keys: [], scanned: 0, truncated: false })),
  getKey: vi.fn(async () => ({ key: "k", type: "string", ttl: -1, size: 1, value: { kind: "string", value: "v" } })),
  setStringValue: vi.fn(async () => undefined),
  setTtl: vi.fn(async () => undefined),
  delKey: vi.fn(async () => undefined),
}));

import * as r from "@/lib/connections/redis";
import { redisTools } from "./redis";

const cfg = { mode: "single" as const, host: "h", port: 6379, tls: false };
const tools = () => redisTools("c1", cfg);

describe("redisTools", () => {
  beforeEach(() => vi.clearAllMocks());
  it("tags categories and exposes no raw command", () => {
    const names = tools().map((t) => t.name);
    const cat = Object.fromEntries(tools().map((t) => [t.name, t.category]));
    expect(cat["redis_get_key"]).toBe("read");
    expect(cat["redis_set_string"]).toBe("write");
    expect(cat["redis_delete_key"]).toBe("destructive");
    expect(names).not.toContain("redis_run_command");
  });
  it("redis_get_key delegates", async () => {
    const t = tools().find((x) => x.name === "redis_get_key")!;
    await t.execute({ key: "k", db: 0 });
    expect(r.getKey).toHaveBeenCalledWith("c1", cfg, "k", 0);
  });
  it("redis_delete_key delegates", async () => {
    const t = tools().find((x) => x.name === "redis_delete_key")!;
    await t.execute({ key: "k" });
    expect(r.delKey).toHaveBeenCalledWith("c1", cfg, "k", undefined);
  });
});
```

- [ ] **Step 2: Run** `npm test -- src/lib/ai/tools/redis.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** — create `src/lib/ai/tools/redis.ts`:
```ts
import { z } from "zod";
import type { RedisConfig } from "@/lib/connections/types";
import { info, listKeys, getKey, setStringValue, setTtl, delKey } from "@/lib/connections/redis";
import type { AiTool } from "./types";

export function redisTools(connectionId: string, config: RedisConfig): AiTool[] {
  const dbArg = z.number().int().min(0).optional();
  return [
    {
      name: "redis_info",
      description: "Server INFO (optionally a single section, e.g. 'memory').",
      category: "read",
      inputSchema: z.object({ section: z.string().optional() }),
      execute: async ({ section }) => info(connectionId, config, section as string | undefined),
    },
    {
      name: "redis_list_keys",
      description: "Scan keys matching a glob pattern (default '*'), with type/ttl/size.",
      category: "read",
      inputSchema: z.object({ pattern: z.string().optional(), db: dbArg }),
      execute: async ({ pattern, db }) =>
        listKeys(connectionId, config, { pattern: pattern as string | undefined, db: db as number | undefined }),
    },
    {
      name: "redis_get_key",
      description: "Read one key's typed value (string/hash/list/set/zset/stream/json).",
      category: "read",
      inputSchema: z.object({ key: z.string(), db: dbArg }),
      execute: async ({ key, db }) => getKey(connectionId, config, key as string, db as number | undefined),
    },
    {
      name: "redis_set_string",
      description: "Set a string key's value.",
      category: "write",
      inputSchema: z.object({ key: z.string(), value: z.string(), db: dbArg }),
      execute: async ({ key, value, db }) => {
        await setStringValue(connectionId, config, key as string, value as string, db as number | undefined);
        return { ok: true, key };
      },
    },
    {
      name: "redis_set_ttl",
      description: "Set a key's TTL in seconds (negative clears the expiry).",
      category: "write",
      inputSchema: z.object({ key: z.string(), ttlSeconds: z.number().int(), db: dbArg }),
      execute: async ({ key, ttlSeconds, db }) => {
        await setTtl(connectionId, config, key as string, ttlSeconds as number, db as number | undefined);
        return { ok: true, key };
      },
    },
    {
      name: "redis_delete_key",
      description: "Delete a key. DESTRUCTIVE.",
      category: "destructive",
      inputSchema: z.object({ key: z.string(), db: dbArg }),
      execute: async ({ key, db }) => {
        await delKey(connectionId, config, key as string, db as number | undefined);
        return { ok: true, deleted: key };
      },
    },
  ];
}
```

- [ ] **Step 4: Run** `npm test -- src/lib/ai/tools/redis.test.ts` — expect PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expect PASS.
```bash
git add src/lib/ai/tools/redis.ts src/lib/ai/tools/redis.test.ts
git commit -m "feat(ai): redis tools (typed only, no raw command)"
```

---

## Task 6: Kafka tools

**Files:** Create `src/lib/ai/tools/kafka.ts`; Test `src/lib/ai/tools/kafka.test.ts`.

Driver (config-only): `listTopicsWithStats(cfg)`, `describeTopic(cfg,name)`, `fetchMessages(cfg,topic,{limit,fromBeginning,partition?})`, `listConsumerGroupsWithLag(cfg)`, `describeConsumerGroup(cfg,groupId)`, `getClusterSummary(cfg)`, `produceMessage(cfg,topic,{key?,value,headers?})`, `createTopic(cfg,name,partitions,replicationFactor)`, `alterTopicConfig(cfg,topic,entries:{name,value}[])`, `addTopicPartitions(cfg,topic,totalPartitions)`, `deleteTopic(cfg,name)`, `emptyTopic(cfg,topic)`, `resetGroupOffsets(cfg,groupId,topic,target:ResetOffsetTarget,partitions?)`, `deleteConsumerGroup(cfg,groupId)`.

- [ ] **Step 1: Write the failing test** — create `src/lib/ai/tools/kafka.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/kafka", () => ({
  listTopicsWithStats: vi.fn(async () => []),
  describeTopic: vi.fn(async () => ({ name: "t", partitions: [], configs: [] })),
  fetchMessages: vi.fn(async () => []),
  listConsumerGroupsWithLag: vi.fn(async () => []),
  describeConsumerGroup: vi.fn(async () => ({ groupId: "g", state: "Empty", members: [], offsets: [] })),
  getClusterSummary: vi.fn(async () => ({ brokers: [] })),
  produceMessage: vi.fn(async () => undefined),
  createTopic: vi.fn(async () => undefined),
  alterTopicConfig: vi.fn(async () => undefined),
  addTopicPartitions: vi.fn(async () => undefined),
  deleteTopic: vi.fn(async () => undefined),
  emptyTopic: vi.fn(async () => undefined),
  resetGroupOffsets: vi.fn(async () => undefined),
  deleteConsumerGroup: vi.fn(async () => undefined),
}));

import * as k from "@/lib/connections/kafka";
import { kafkaTools } from "./kafka";

const cfg = { clientId: "baklava", brokers: ["b:9092"], ssl: false };
const tools = () => kafkaTools("c1", cfg);

describe("kafkaTools", () => {
  beforeEach(() => vi.clearAllMocks());
  it("tags categories", () => {
    const cat = Object.fromEntries(tools().map((t) => [t.name, t.category]));
    expect(cat["kafka_fetch_messages"]).toBe("read");
    expect(cat["kafka_produce_message"]).toBe("write");
    expect(cat["kafka_delete_topic"]).toBe("destructive");
    expect(cat["kafka_empty_topic"]).toBe("destructive");
    expect(cat["kafka_reset_group_offsets"]).toBe("destructive");
  });
  it("kafka_produce_message delegates", async () => {
    const t = tools().find((x) => x.name === "kafka_produce_message")!;
    await t.execute({ topic: "t", value: "hi" });
    expect(k.produceMessage).toHaveBeenCalledWith(cfg, "t", expect.objectContaining({ value: "hi" }));
  });
  it("kafka_fetch_messages delegates with limit + fromBeginning", async () => {
    const t = tools().find((x) => x.name === "kafka_fetch_messages")!;
    await t.execute({ topic: "t", limit: 10, fromBeginning: true });
    expect(k.fetchMessages).toHaveBeenCalledWith(cfg, "t", expect.objectContaining({ limit: 10, fromBeginning: true }));
  });
  it("kafka_reset_group_offsets passes a target", async () => {
    const t = tools().find((x) => x.name === "kafka_reset_group_offsets")!;
    await t.execute({ groupId: "g", topic: "t", target: "earliest" });
    expect(k.resetGroupOffsets).toHaveBeenCalledWith(cfg, "g", "t", { kind: "earliest" }, undefined);
  });
});
```

- [ ] **Step 2: Run** `npm test -- src/lib/ai/tools/kafka.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** — create `src/lib/ai/tools/kafka.ts`:
```ts
import { z } from "zod";
import type { KafkaConfig } from "@/lib/connections/types";
import {
  listTopicsWithStats,
  describeTopic,
  fetchMessages,
  listConsumerGroupsWithLag,
  describeConsumerGroup,
  getClusterSummary,
  produceMessage,
  createTopic,
  alterTopicConfig,
  addTopicPartitions,
  deleteTopic,
  emptyTopic,
  resetGroupOffsets,
  deleteConsumerGroup,
} from "@/lib/connections/kafka";
import type { AiTool } from "./types";

export function kafkaTools(_connectionId: string, config: KafkaConfig): AiTool[] {
  return [
    {
      name: "kafka_list_topics",
      description: "List topics with partition counts and message totals.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listTopicsWithStats(config),
    },
    {
      name: "kafka_describe_topic",
      description: "Partitions, offsets, ISR and configs for a topic.",
      category: "read",
      inputSchema: z.object({ topic: z.string() }),
      execute: async ({ topic }) => describeTopic(config, topic as string),
    },
    {
      name: "kafka_fetch_messages",
      description: "Read up to `limit` messages from a topic (read-only; uses an ephemeral consumer group).",
      category: "read",
      inputSchema: z.object({
        topic: z.string(),
        limit: z.number().int().min(1).max(200).default(20),
        fromBeginning: z.boolean().default(false),
        partition: z.number().int().min(0).optional(),
      }),
      execute: async ({ topic, limit, fromBeginning, partition }) =>
        fetchMessages(config, topic as string, {
          limit: (limit as number) ?? 20,
          fromBeginning: (fromBeginning as boolean) ?? false,
          partition: partition as number | undefined,
        }),
    },
    {
      name: "kafka_list_consumer_groups",
      description: "List consumer groups with member count, topic count and total lag.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listConsumerGroupsWithLag(config),
    },
    {
      name: "kafka_describe_consumer_group",
      description: "Members and per-partition offsets/lag for a consumer group.",
      category: "read",
      inputSchema: z.object({ groupId: z.string() }),
      execute: async ({ groupId }) => describeConsumerGroup(config, groupId as string),
    },
    {
      name: "kafka_cluster_summary",
      description: "Brokers, controller, topic/partition counts, under-replicated/offline partitions, top topics.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => getClusterSummary(config),
    },
    {
      name: "kafka_produce_message",
      description: "Produce a single message to a topic.",
      category: "write",
      inputSchema: z.object({
        topic: z.string(),
        value: z.string(),
        key: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      execute: async ({ topic, value, key, headers }) => {
        await produceMessage(config, topic as string, {
          value: value as string,
          key: key as string | undefined,
          headers: headers as Record<string, string> | undefined,
        });
        return { ok: true, topic };
      },
    },
    {
      name: "kafka_create_topic",
      description: "Create a topic.",
      category: "write",
      inputSchema: z.object({
        name: z.string(),
        partitions: z.number().int().min(1).default(1),
        replicationFactor: z.number().int().min(1).default(1),
      }),
      execute: async ({ name, partitions, replicationFactor }) => {
        await createTopic(config, name as string, (partitions as number) ?? 1, (replicationFactor as number) ?? 1);
        return { ok: true, created: name };
      },
    },
    {
      name: "kafka_alter_topic_config",
      description: "Set topic config entries (e.g. retention.ms).",
      category: "write",
      inputSchema: z.object({
        topic: z.string(),
        entries: z.array(z.object({ name: z.string(), value: z.string() })).min(1),
      }),
      execute: async ({ topic, entries }) => {
        await alterTopicConfig(config, topic as string, entries as { name: string; value: string }[]);
        return { ok: true, topic };
      },
    },
    {
      name: "kafka_add_partitions",
      description: "Increase a topic's partition count to `totalPartitions`.",
      category: "write",
      inputSchema: z.object({ topic: z.string(), totalPartitions: z.number().int().min(1) }),
      execute: async ({ topic, totalPartitions }) => {
        await addTopicPartitions(config, topic as string, totalPartitions as number);
        return { ok: true, topic };
      },
    },
    {
      name: "kafka_delete_topic",
      description: "Delete a topic. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        await deleteTopic(config, name as string);
        return { ok: true, deleted: name };
      },
    },
    {
      name: "kafka_empty_topic",
      description: "Delete and recreate a topic to drop all its messages. DESTRUCTIVE.",
      category: "destructive",
      inputSchema: z.object({ topic: z.string() }),
      execute: async ({ topic }) => {
        await emptyTopic(config, topic as string);
        return { ok: true, emptied: topic };
      },
    },
    {
      name: "kafka_reset_group_offsets",
      description:
        "Reset a consumer group's committed offsets for a topic to earliest or latest. DESTRUCTIVE (can skip or replay data).",
      category: "destructive",
      inputSchema: z.object({
        groupId: z.string(),
        topic: z.string(),
        target: z.enum(["earliest", "latest"]),
        partitions: z.array(z.number().int().min(0)).optional(),
      }),
      execute: async ({ groupId, topic, target, partitions }) => {
        await resetGroupOffsets(
          config,
          groupId as string,
          topic as string,
          { kind: target as "earliest" | "latest" },
          partitions as number[] | undefined,
        );
        return { ok: true, groupId, topic, target };
      },
    },
    {
      name: "kafka_delete_consumer_group",
      description: "Delete a consumer group. DESTRUCTIVE.",
      category: "destructive",
      inputSchema: z.object({ groupId: z.string() }),
      execute: async ({ groupId }) => {
        await deleteConsumerGroup(config, groupId as string);
        return { ok: true, deleted: groupId };
      },
    },
  ];
}
```

- [ ] **Step 4: Run** `npm test -- src/lib/ai/tools/kafka.test.ts` — expect PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expect PASS.
```bash
git add src/lib/ai/tools/kafka.ts src/lib/ai/tools/kafka.test.ts
git commit -m "feat(ai): kafka tools (read/write/destructive)"
```

---

## Task 7: Kubernetes tools

**Files:** Create `src/lib/ai/tools/kubernetes.ts`; Test `src/lib/ai/tools/kubernetes.test.ts`.

Driver (connectionId-first): `listPods/listDeployments/listServices/listConfigMaps/listSecrets/listNamespaces(id,cfg,namespace?)`, `getPodLogs(id,cfg,ns,pod,{tailLines?,container?})`, `readResourceYaml(id,cfg,kind,namespace,name,{redactSecretValues?})`, `replaceResourceYaml(id,cfg,yaml)`, `deleteResource(id,cfg,kind,namespace,name)`. Builder receives `policy` (Task 3) for the secret flag.

- [ ] **Step 1: Write the failing test** — create `src/lib/ai/tools/kubernetes.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/connections/kubernetes", () => ({
  listPods: vi.fn(async () => []),
  listDeployments: vi.fn(async () => []),
  listServices: vi.fn(async () => []),
  listConfigMaps: vi.fn(async () => []),
  listSecrets: vi.fn(async () => []),
  listNamespaces: vi.fn(async () => []),
  getPodLogs: vi.fn(async () => "log line"),
  readResourceYaml: vi.fn(async () => "kind: Secret"),
  replaceResourceYaml: vi.fn(async () => undefined),
  deleteResource: vi.fn(async () => undefined),
}));

import * as k from "@/lib/connections/kubernetes";
import { kubernetesTools } from "./kubernetes";
import { DEFAULT_POLICY } from "../permissions";

const cfg = { source: "path" as const, kubeconfigPath: "~/.kube/config" };

describe("kubernetesTools", () => {
  beforeEach(() => vi.clearAllMocks());
  it("tags categories and excludes exec", () => {
    const ts = kubernetesTools("c1", cfg, DEFAULT_POLICY);
    const cat = Object.fromEntries(ts.map((t) => [t.name, t.category]));
    const names = ts.map((t) => t.name);
    expect(cat["k8s_pod_logs"]).toBe("read");
    expect(cat["k8s_apply_yaml"]).toBe("write");
    expect(cat["k8s_delete_resource"]).toBe("destructive");
    expect(names.some((n) => n.includes("exec"))).toBe(false);
  });
  it("k8s_get_yaml redacts secrets by default", async () => {
    const t = kubernetesTools("c1", cfg, DEFAULT_POLICY).find((x) => x.name === "k8s_get_yaml")!;
    await t.execute({ kind: "secret", namespace: "default", name: "s" });
    expect(k.readResourceYaml).toHaveBeenCalledWith("c1", cfg, "secret", "default", "s", { redactSecretValues: true });
  });
  it("k8s_get_yaml passes values through when policy opts in", async () => {
    const policy = { ...DEFAULT_POLICY, allowK8sSecretValues: true };
    const t = kubernetesTools("c1", cfg, policy).find((x) => x.name === "k8s_get_yaml")!;
    await t.execute({ kind: "secret", namespace: "default", name: "s" });
    expect(k.readResourceYaml).toHaveBeenCalledWith("c1", cfg, "secret", "default", "s", { redactSecretValues: false });
  });
  it("k8s_delete_resource delegates", async () => {
    const t = kubernetesTools("c1", cfg, DEFAULT_POLICY).find((x) => x.name === "k8s_delete_resource")!;
    await t.execute({ kind: "pod", namespace: "default", name: "p" });
    expect(k.deleteResource).toHaveBeenCalledWith("c1", cfg, "pod", "default", "p");
  });
});
```

- [ ] **Step 2: Run** `npm test -- src/lib/ai/tools/kubernetes.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** — create `src/lib/ai/tools/kubernetes.ts`:
```ts
import { z } from "zod";
import type { KubernetesConfig } from "@/lib/connections/types";
import type { PermissionPolicy } from "../permissions";
import {
  listPods,
  listDeployments,
  listServices,
  listConfigMaps,
  listSecrets,
  listNamespaces,
  getPodLogs,
  readResourceYaml,
  replaceResourceYaml,
  deleteResource,
} from "@/lib/connections/kubernetes";
import type { AiTool } from "./types";

const KIND = z.enum(["pod", "deployment", "service", "configmap", "secret", "namespace"]);

export function kubernetesTools(
  connectionId: string,
  config: KubernetesConfig,
  policy: PermissionPolicy,
): AiTool[] {
  const ns = z.object({ namespace: z.string().optional() });
  const list = (name: string, fn: (id: string, c: KubernetesConfig, namespace?: string) => Promise<unknown>, label: string): AiTool => ({
    name,
    description: `List ${label} (optionally scoped to a namespace).`,
    category: "read",
    inputSchema: ns,
    execute: async ({ namespace }) => fn(connectionId, config, namespace as string | undefined),
  });
  return [
    list("k8s_list_pods", listPods, "pods"),
    list("k8s_list_deployments", listDeployments, "deployments"),
    list("k8s_list_services", listServices, "services"),
    list("k8s_list_configmaps", listConfigMaps, "config maps"),
    list("k8s_list_secrets", listSecrets, "secrets (names + key counts only)"),
    list("k8s_list_namespaces", listNamespaces, "namespaces"),
    {
      name: "k8s_pod_logs",
      description: "Read the last N lines of a pod's logs (one-shot, not following).",
      category: "read",
      inputSchema: z.object({
        namespace: z.string(),
        pod: z.string(),
        tailLines: z.number().int().min(1).max(2000).default(200),
        container: z.string().optional(),
      }),
      execute: async ({ namespace, pod, tailLines, container }) =>
        getPodLogs(connectionId, config, namespace as string, pod as string, {
          tailLines: tailLines as number | undefined,
          container: container as string | undefined,
        }),
    },
    {
      name: "k8s_get_yaml",
      description: "Get a resource's YAML manifest. Secret values are redacted unless this connection allows them.",
      category: "read",
      inputSchema: z.object({ kind: KIND, namespace: z.string().optional(), name: z.string() }),
      execute: async ({ kind, namespace, name }) =>
        readResourceYaml(connectionId, config, kind as string, namespace as string | undefined, name as string, {
          redactSecretValues: policy.allowK8sSecretValues !== true,
        }),
    },
    {
      name: "k8s_apply_yaml",
      description: "Apply (replace) a resource from a full YAML manifest.",
      category: "write",
      inputSchema: z.object({ yaml: z.string() }),
      execute: async ({ yaml }) => {
        await replaceResourceYaml(connectionId, config, yaml as string);
        return { ok: true };
      },
    },
    {
      name: "k8s_delete_resource",
      description: "Delete a resource. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: z.object({ kind: KIND, namespace: z.string().optional(), name: z.string() }),
      execute: async ({ kind, namespace, name }) => {
        await deleteResource(connectionId, config, kind as string, namespace as string | undefined, name as string);
        return { ok: true, deleted: `${kind}/${name}` };
      },
    },
  ];
}
```

- [ ] **Step 4: Run** `npm test -- src/lib/ai/tools/kubernetes.test.ts` — expect PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck` — expect PASS.
```bash
git add src/lib/ai/tools/kubernetes.ts src/lib/ai/tools/kubernetes.test.ts
git commit -m "feat(ai): kubernetes tools (exec excluded, secret redaction)"
```

---

## Task 8: Register the four techs

**Files:** Modify `src/lib/ai/supported.ts`, `src/lib/ai/tools/registry.ts`, `src/lib/ai/tools/registry.test.ts`.

- [ ] **Step 1: Supported list** — in `src/lib/ai/supported.ts`:
```ts
export const AI_SUPPORTED_TECHS: TechId[] = ["postgres", "docker", "mysql", "sqlserver", "mongo", "redis", "kafka", "kubernetes"];
```

- [ ] **Step 2: BUILDERS** — in `src/lib/ai/tools/registry.ts`, import the four modules and add entries (note kubernetes uses the 3-arg form):
```ts
import { mongoTools } from "./mongo";
import { redisTools } from "./redis";
import { kafkaTools } from "./kafka";
import { kubernetesTools } from "./kubernetes";
// …in BUILDERS:
  mongo: (id, cfg) => mongoTools(id, cfg as never),
  redis: (id, cfg) => redisTools(id, cfg as never),
  kafka: (id, cfg) => kafkaTools(id, cfg as never),
  kubernetes: (id, cfg, policy) => kubernetesTools(id, cfg as never, policy),
```

- [ ] **Step 3: Registry test** — append to `src/lib/ai/tools/registry.test.ts`:
```ts
describe("buildTools — phase 2", () => {
  const k8sCfg = { source: "path", kubeconfigPath: "~/.kube/config" };
  it("exposes mongo read tools under default policy", () => {
    const names = buildTools("mongo", "c1", { uri: "mongodb://h" }, DEFAULT_POLICY).map((t) => t.name);
    expect(names).toContain("mongo_find");
    expect(names).not.toContain("mongo_drop_collection");
  });
  it("exposes kafka read tools and hides destructive under default policy", () => {
    const names = buildTools("kafka", "c1", { clientId: "b", brokers: ["x"], ssl: false }, DEFAULT_POLICY).map((t) => t.name);
    expect(names).toContain("kafka_list_topics");
    expect(names).not.toContain("kafka_delete_topic");
  });
  it("exposes kubernetes read tools (incl get_yaml) under default policy", () => {
    const names = buildTools("kubernetes", "c1", k8sCfg, DEFAULT_POLICY).map((t) => t.name);
    expect(names).toContain("k8s_get_yaml");
    expect(names).not.toContain("k8s_delete_resource");
  });
});
```
(`buildTools` + `DEFAULT_POLICY` are already imported in this file from earlier tasks; do not duplicate imports.)

- [ ] **Step 4: Verify**

Run: `npm test -- src/lib/ai/tools/registry.test.ts` — expect PASS.
Run: `npm run typecheck && npm run lint` — expect PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/ai/supported.ts src/lib/ai/tools/registry.ts src/lib/ai/tools/registry.test.ts
git commit -m "feat(ai): register mongo/redis/kafka/kubernetes tools (all 8 techs)"
```

---

## Task 9: Secret-toggle UI (policy route + chip popover)

**Files:** Modify `src/app/api/ai/connections/[id]/policy/route.ts`, `src/components/ai/working-set.tsx`, `src/app/assistant/assistant-client.tsx`.

- [ ] **Step 1: Persist the flag in the policy route.** In the PUT handler of `src/app/api/ai/connections/[id]/policy/route.ts`, add `allowK8sSecretValues` to the `setPolicy` object:
```ts
    setPolicy(id, {
      mode: body.mode === "autonomous" ? "autonomous" : "confirm",
      read: body.read !== false,
      write: Boolean(body.write),
      destructive: Boolean(body.destructive),
      confirmDestructive: body.confirmDestructive,
      allowK8sSecretValues: Boolean(body.allowK8sSecretValues),
    });
```
(Read the file first; keep the rest.)

- [ ] **Step 2: Extend `PolicyView` + the popover** in `src/components/ai/working-set.tsx`. Read the file. (a) Add `allowK8sSecretValues?: boolean;` to the exported `PolicyView` interface. (b) Pass the connection's tech to `PolicyChip` — change the chip usage to include `tech={c.tech}` and add `tech: string` to `PolicyChip`'s props. (c) In `PolicyChip`, after the three permission rows, render a Kubernetes-only switch:
```tsx
      {tech === "kubernetes" ? (
        <>
          <div className="my-1 h-px bg-border/60" />
          <label className="flex items-center justify-between gap-3 py-1 text-xs">
            <span>Reveal secret values</span>
            <Switch
              checked={Boolean(policy.allowK8sSecretValues)}
              onCheckedChange={(v: boolean) => onChange(id, { ...policy, allowK8sSecretValues: v })}
            />
          </label>
        </>
      ) : null}
```
The `row(...)` helper already builds the read/write/destructive switches via `onChange(id, { ...policy, [key]: v })`, which preserves the new field. `PolicyChip` already receives `policy` + `onChange`.

- [ ] **Step 3: Carry the field in the client `PolicyView`.** In `src/app/assistant/assistant-client.tsx`, the `PolicyView` type is imported from `working-set` (so Step 2 covers it). Confirm `changePolicy` PUTs the whole `PolicyView` (it does: `body: JSON.stringify(p)`), so `allowK8sSecretValues` round-trips. No change needed beyond confirming.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run lint` — expect PASS.
Run: `npm test` — all pass.

- [ ] **Step 5: Commit**
```bash
git add "src/app/api/ai/connections/[id]/policy/route.ts" src/components/ai/working-set.tsx
git commit -m "feat(ai): per-connection 'reveal K8s secret values' toggle in policy popover"
```

---

## Task 10: Full verification

**Files:** none.

- [ ] **Step 1: Full gate** — `npm test && npm run typecheck && npm run lint && npm run build` — all green.
- [ ] **Step 2: Manual (needs a key + live services)** — `npm run dev` → `/assistant`. `/` now lists Mongo, Redis, Kafka, Kubernetes connections too. Add a Mongo connection; ask "how many documents in &lt;collection&gt;?" → expect `mongo_find`/`mongo_aggregate` (read), no approval card. Ask it to run an aggregation with a `$out` stage → it's rejected.
- [ ] **Step 3: Manual (writes/destructive + approval)** — enable write+destructive on a throwaway connection's chip; have the AI produce a Kafka message / set a Redis key / create then drop a Mongo collection → each write/destructive shows an approval card naming the connection.
- [ ] **Step 4: Manual (K8s secrets toggle)** — add a Kubernetes connection. Ask the AI to `get_yaml` a Secret → values are redacted (keys only). Flip the chip's "Reveal secret values" switch on, ask again → values appear. Confirm `k8s_delete_resource` shows an approval card and exec is not offered.
- [ ] **Step 5: Commit checkpoint**
```bash
git commit --allow-empty -m "chore(ai): phase 2 tools verified"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** K8s helpers getPodLogs/deleteResource + readResourceYaml redact (Task 1) · permissions flag (Task 2) · Builder widening to pass policy (Task 3) · mongo tools incl. `$out`/`$merge` guard (Task 4) · redis typed-only (Task 5) · kafka incl. reset-offsets=destructive (Task 6) · k8s tools, exec excluded, secret redaction wired to policy (Task 7) · registration → all 8 (Task 8) · policy-route + popover toggle (Task 9) · verification incl. secret toggle (Task 10). All spec sections map to a task.
- **Placeholder scan:** every code step is concrete; the mongo guard, the redaction wiring, and the kafka classifications are explicit.
- **Type consistency:** driver fns called with the exact arg order grepped from each driver (mongo/redis/k8s connectionId-first; kafka config-first); `kubernetesTools(id, cfg, policy)` matches the widened `Builder` (Task 3) and the BUILDERS entry (Task 8); `PermissionPolicy.allowK8sSecretValues` (Task 2) read in the k8s tool (Task 7), persisted by the route (Task 9), and surfaced via `PolicyView` (Task 9); `readResourceYaml`'s new `opts` arg (Task 1) matches the k8s tool call + its test (Task 7).
- **Ordering:** helpers/flag/Builder (1–3) precede the tool modules (4–7); registration (8) imports modules that exist by then; UI toggle (9) after the flag + tool exist. Each task leaves the tree green.
