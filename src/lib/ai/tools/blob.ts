import { z } from "zod";
import type { CORSRule, LifecycleRule } from "@aws-sdk/client-s3";
import type { TechId } from "@/lib/connections/types";
import { blobTech } from "@/lib/connections/blob-registry";
import {
  listBuckets,
  createBucket,
  deleteBucket,
  listObjects,
  headObject,
  uploadObject,
  copyObject,
  deleteObjects,
  getBucketCors,
  putBucketCors,
  getBucketLifecycle,
  putBucketLifecycle,
} from "@/lib/connections/s3";
import type { AiTool } from "./types";

// Object content is intentionally out of reach: there is no content-read or
// presigned-URL tool, so object bytes never enter the model context. Uploads
// are bounded to small text payloads so the AI can't smuggle large/binary blobs.
const MAX_UPLOAD_BYTES = 256 * 1024;
const TEXT_CONTENT_TYPE =
  /^(text\/|application\/(json|xml|yaml|x-yaml|toml|x-ndjson|csv|javascript))/i;

/**
 * Shared tool factory for every S3-compatible tech (r2, minio, s3). They all
 * route through the same s3.ts ops, so one `blob_*` tool set serves all three;
 * the conversation layer addresses them by connection. The client is resolved
 * lazily per call from the cached pool in s3.ts.
 */
export function blobTools(tech: TechId, connectionId: string, config: unknown): AiTool[] {
  const client = async () => {
    const bt = blobTech(tech);
    if (!bt) throw new Error(`No blob client registered for tech: ${tech}`);
    return bt.clientFor(connectionId, config);
  };

  const bucket = z.string().min(1);

  return [
    // ── read ──────────────────────────────────────────────────────────────
    {
      name: "blob_list_buckets",
      description: "List all buckets with their creation time.",
      category: "read",
      inputSchema: z.object({}),
      execute: async () => listBuckets(await client()),
    },
    {
      name: "blob_list_objects",
      description:
        "List objects and folders under a prefix (one level, '/' delimited). Pass the returned token to page.",
      category: "read",
      inputSchema: z.object({
        bucket,
        prefix: z.string().optional(),
        token: z.string().optional(),
      }),
      execute: async ({ bucket, prefix, token }) =>
        listObjects(await client(), bucket as string, (prefix as string) ?? "", (token as string) ?? null),
    },
    {
      name: "blob_head_object",
      description:
        "Object metadata only (size, content-type, etag, last-modified, custom metadata) — never the object's contents.",
      category: "read",
      inputSchema: z.object({ bucket, key: z.string().min(1) }),
      execute: async ({ bucket, key }) => headObject(await client(), bucket as string, key as string),
    },
    {
      name: "blob_get_cors",
      description: "Get the bucket's CORS rules (empty if none configured).",
      category: "read",
      inputSchema: z.object({ bucket }),
      execute: async ({ bucket }) => getBucketCors(await client(), bucket as string),
    },
    {
      name: "blob_get_lifecycle",
      description: "Get the bucket's lifecycle rules (empty if none configured).",
      category: "read",
      inputSchema: z.object({ bucket }),
      execute: async ({ bucket }) => getBucketLifecycle(await client(), bucket as string),
    },

    // ── write ─────────────────────────────────────────────────────────────
    {
      name: "blob_create_bucket",
      description: "Create a bucket.",
      category: "write",
      inputSchema: z.object({ name: z.string().min(1) }),
      execute: async ({ name }) =>
        createBucket(await client(), name as string, { lax: tech === "minio" }),
    },
    {
      name: "blob_upload_object",
      description:
        "Upload a small TEXT object from a string body (≤256KB, text/json/xml/yaml/csv only). For binary or large files, use the workspace UI.",
      category: "write",
      inputSchema: z.object({
        bucket,
        key: z.string().min(1),
        content: z.string(),
        contentType: z.string().optional(),
      }),
      execute: async ({ bucket, key, content, contentType }) => {
        const type = (contentType as string) || "text/plain";
        if (!TEXT_CONTENT_TYPE.test(type)) {
          throw new Error(
            `blob_upload_object is text-only; refusing content-type "${type}".`,
          );
        }
        const bytes = Buffer.byteLength(content as string, "utf8");
        if (bytes > MAX_UPLOAD_BYTES) {
          throw new Error(
            `Body is ${bytes} bytes; the limit is ${MAX_UPLOAD_BYTES} (256KB).`,
          );
        }
        await uploadObject(await client(), bucket as string, key as string, Buffer.from(content as string, "utf8"), type);
        return { uploaded: { bucket, key, bytes, contentType: type } };
      },
    },
    {
      name: "blob_copy_object",
      description: "Server-side copy an object to a new key in the same bucket (source kept).",
      category: "write",
      inputSchema: z.object({ bucket, from: z.string().min(1), to: z.string().min(1) }),
      execute: async ({ bucket, from, to }) => {
        await copyObject(await client(), bucket as string, from as string, to as string);
        return { copied: { from, to } };
      },
    },
    {
      name: "blob_put_cors",
      description: "Replace the bucket's CORS rules with the supplied array of CORS rule objects.",
      category: "write",
      inputSchema: z.object({ bucket, rules: z.array(z.record(z.string(), z.unknown())) }),
      execute: async ({ bucket, rules }) => {
        await putBucketCors(await client(), bucket as string, rules as unknown as CORSRule[]);
        return { ok: true };
      },
    },

    // ── destructive ───────────────────────────────────────────────────────
    {
      name: "blob_put_lifecycle",
      // Destructive, not write: a lifecycle rule with an Expiration can schedule
      // deletion of every matching object, so it sits behind the destructive gate.
      description:
        "Replace the bucket's lifecycle rules. DESTRUCTIVE: rules with an Expiration schedule deletion of matching objects.",
      category: "destructive",
      inputSchema: z.object({ bucket, rules: z.array(z.record(z.string(), z.unknown())) }),
      execute: async ({ bucket, rules }) => {
        await putBucketLifecycle(await client(), bucket as string, rules as unknown as LifecycleRule[]);
        return { ok: true };
      },
    },
    {
      name: "blob_delete_objects",
      description: "Delete one or more objects by key (batch). Surfaces per-key failures.",
      category: "destructive",
      inputSchema: z.object({ bucket, keys: z.array(z.string().min(1)).min(1) }),
      execute: async ({ bucket, keys }) => {
        await deleteObjects(await client(), bucket as string, keys as string[]);
        return { deleted: keys };
      },
    },
    {
      name: "blob_delete_bucket",
      description: "Delete a bucket (must be empty).",
      category: "destructive",
      inputSchema: z.object({ bucket }),
      execute: async ({ bucket }) => {
        await deleteBucket(await client(), bucket as string);
        return { deleted: bucket };
      },
    },
    {
      name: "blob_move_object",
      description:
        "Move/rename an object: copy to the new key, then delete the source. Destructive because the source is removed.",
      category: "destructive",
      inputSchema: z.object({ bucket, from: z.string().min(1), to: z.string().min(1) }),
      execute: async ({ bucket, from, to }) => {
        const c = await client();
        await copyObject(c, bucket as string, from as string, to as string);
        try {
          await deleteObjects(c, bucket as string, [from as string]);
        } catch (e) {
          // Copy landed but the source delete failed — make the duplicate explicit
          // so the caller doesn't retry blindly and pile up copies.
          throw new Error(
            `Copied to "${to}" but could not delete source "${from}" — a duplicate now exists at "${to}". ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        return { moved: { from, to } };
      },
    },
  ];
}
