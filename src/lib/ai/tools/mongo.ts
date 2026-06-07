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
      execute: async ({ database }) =>
        listCollections(connectionId, config, database as string),
    },
    {
      name: "mongo_find",
      description:
        "Find documents. filter/projection/sort are extended-JSON (EJSON) strings.",
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
          throw new Error(
            `Invalid pipeline EJSON: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        if (!Array.isArray(stages)) {
          throw new Error("Pipeline must be a JSON array of stages.");
        }
        const writes = stages.some(
          (s) =>
            s &&
            typeof s === "object" &&
            ("$out" in (s as object) || "$merge" in (s as object)),
        );
        if (writes) {
          throw new Error(
            "aggregate is read-only: $out / $merge stages are not allowed.",
          );
        }
        return runAggregate(
          connectionId,
          config,
          database as string,
          collection as string,
          pipeline as string,
        );
      },
    },
    {
      name: "mongo_sample_schema",
      description: "Infer the collection's field shape by sampling documents.",
      category: "read",
      inputSchema: ns.extend({
        sampleSize: z.number().int().min(10).max(5000).optional(),
      }),
      execute: async ({ database, collection, sampleSize }) =>
        sampleSchema(
          connectionId,
          config,
          database as string,
          collection as string,
          sampleSize as number | undefined,
        ),
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
        insertDocument(
          connectionId,
          config,
          database as string,
          collection as string,
          document as string,
        ),
    },
    {
      name: "mongo_replace_document",
      description:
        "Replace one document matching the filter (both EJSON strings).",
      category: "write",
      inputSchema: ns.extend({ filter: z.string(), document: z.string() }),
      execute: async ({ database, collection, filter, document }) =>
        replaceDocument(
          connectionId,
          config,
          database as string,
          collection as string,
          filter as string,
          document as string,
        ),
    },
    {
      name: "mongo_create_index",
      description:
        'Create an index. keys is an EJSON object like {"field":1}.',
      category: "write",
      inputSchema: ns.extend({
        keys: z.string(),
        name: z.string().optional(),
        unique: z.boolean().optional(),
      }),
      execute: async ({ database, collection, keys, name, unique }) =>
        createIndex(connectionId, config, database as string, collection as string, {
          keysEjson: keys as string,
          options: {
            name: name as string | undefined,
            unique: unique as boolean | undefined,
          },
        }),
    },
    {
      name: "mongo_create_collection",
      description: "Create a new collection.",
      category: "write",
      inputSchema: z.object({ database: z.string(), name: z.string() }),
      execute: async ({ database, name }) => {
        await createCollectionOp(connectionId, config, database as string, {
          name: name as string,
        });
        return { ok: true, created: `${database as string}.${name as string}` };
      },
    },
    {
      name: "mongo_delete_document",
      description: "Delete ONE document matching the filter (EJSON). DESTRUCTIVE.",
      category: "destructive",
      inputSchema: ns.extend({ filter: z.string() }),
      execute: async ({ database, collection, filter }) =>
        deleteDocument(
          connectionId,
          config,
          database as string,
          collection as string,
          filter as string,
        ),
    },
    {
      name: "mongo_drop_collection",
      description: "Drop (delete) a collection. DESTRUCTIVE and irreversible.",
      category: "destructive",
      inputSchema: ns,
      execute: async ({ database, collection }) => {
        await dropCollectionOp(
          connectionId,
          config,
          database as string,
          collection as string,
        );
        return {
          ok: true,
          dropped: `${database as string}.${collection as string}`,
        };
      },
    },
    {
      name: "mongo_drop_index",
      description: "Drop an index by name. DESTRUCTIVE.",
      category: "destructive",
      inputSchema: ns.extend({ indexName: z.string() }),
      execute: async ({ database, collection, indexName }) => {
        await dropIndex(
          connectionId,
          config,
          database as string,
          collection as string,
          indexName as string,
        );
        return { ok: true, dropped: indexName as string };
      },
    },
  ];
}
