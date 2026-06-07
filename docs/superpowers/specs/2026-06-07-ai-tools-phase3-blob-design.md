# Phase 3 AI Tools — Blob storage (R2 / MinIO / S3)

**Status:** Design approved
**Date:** 2026-06-07
**Author:** eren + Claude

## Goal

Extend the AI tool-calling agent to the three blob-storage technologies —
Cloudflare R2, MinIO, and AWS S3 — bringing AI coverage to all 11 supported
techs. These three already share a single S3-compatible operations core
(`s3.ts`) routed through `blob-registry.ts`, so they are added as **thin
consumers**: one shared tool factory backed entirely by operations that already
exist. No net-new driver operation is introduced.

## Decisions (from brainstorming)

1. **Object-data exposure: metadata + listing only.** The AI can inventory
   storage (list buckets/objects, read object metadata) but **cannot read object
   contents and cannot mint presigned download URLs.** This preserves the
   existing boundary in `s3.ts`, where object bytes never enter app code
   (`getObject` is used only inside `presignGet`). No content-reveal surface
   means **no blob-specific policy flag** is needed (unlike `allowK8sSecretValues`).

2. **Full mutation parity (13 tools).** Bucket + object CRUD, copy, move,
   text-only upload, plus bucket CORS and lifecycle configuration.

3. **Shared `blob_*` tool names.** One tool set across all three techs (not
   `r2_*` / `minio_*` / `s3_*`). Matches the shared-core philosophy; the
   conversation layer already merges same-named tools across connections and
   addresses them by a `connection` discriminator, so a user with both an R2 and
   a MinIO connection gets unified `blob_*` tools with zero duplication.

## Architecture

A single factory in `src/lib/ai/tools/blob.ts`:

```ts
export function blobTools(
  tech: TechId,            // "r2" | "minio" | "s3"
  connectionId: string,
  config: unknown,         // R2Config | MinioConfig | S3Config
): AiTool[]
```

Each tool's `execute` resolves an `S3Client` lazily via the existing
`blob-registry` accessor — `blobTech(tech)!.clientFor(connectionId, config)` —
which returns a cached client from `s3.ts`'s `getCachedClient` pool, so per-call
resolution is cheap and reuses the same client the workspace UI uses. The tool
then delegates to the corresponding `s3.ts` operation. The factory holds no
client of its own; it captures `(tech, connectionId, config)` in closure. A
small private helper inside `blob.ts` (`client()`) wraps the
`blobTech(tech)!.clientFor(...)` call so each `execute` reads cleanly.

Registration:
- `registry.ts` `BUILDERS`: `r2`, `minio`, `s3` each map to
  `(id, cfg) => blobTools(<tech>, id, cfg)`. The 3rd `policy` arg is unused for
  blob techs (same as every non-kubernetes builder).
- `supported.ts` `AI_SUPPORTED_TECHS`: add `"r2"`, `"minio"`, `"s3"`.

## Tool surface (13 tools)

All input schemas are Zod. A `connection` discriminator is added automatically
by `buildConversationTools` when tools of the same name exist across
connections — the factory does not declare it.

### Read (no approval)

| Tool | Args | Delegates to | Returns |
|---|---|---|---|
| `blob_list_buckets` | — | `listBuckets(client)` | `{name, createdAt}[]` |
| `blob_list_objects` | `bucket`, `prefix?`, `token?` | `listObjects(client, bucket, prefix ?? "", token ?? null)` | `{prefix, folders, objects, nextToken}` |
| `blob_head_object` | `bucket`, `key` | `headObject(client, bucket, key)` | `ObjectMeta` (size, contentType, etag, lastModified, metadata, cacheControl, contentDisposition) — **no body** |
| `blob_get_cors` | `bucket` | `getBucketCors(client, bucket)` | `CORSRule[]` |
| `blob_get_lifecycle` | `bucket` | `getBucketLifecycle(client, bucket)` | `LifecycleRule[]` |

### Write (approval in confirm mode)

| Tool | Args | Delegates to | Notes |
|---|---|---|---|
| `blob_create_bucket` | `name` | `createBucket(client, name, { lax: tech === "minio" })` | bucket-name validation inside op |
| `blob_upload_object` | `bucket`, `key`, `content` (string), `contentType?` | `uploadObject(client, bucket, key, Buffer.from(content), contentType ?? "text/plain")` | **guarded** — see Safety |
| `blob_copy_object` | `bucket`, `from`, `to` | `copyObject(client, bucket, from, to)` | server-side copy, source untouched |
| `blob_put_cors` | `bucket`, `rules` (CORSRule[]) | `putBucketCors(client, bucket, rules)` | rules supplied as structured JSON |
| `blob_put_lifecycle` | `bucket`, `rules` (LifecycleRule[]) | `putBucketLifecycle(client, bucket, rules)` | rules supplied as structured JSON |

### Destructive (approval + confirmDestructive)

| Tool | Args | Delegates to | Notes |
|---|---|---|---|
| `blob_delete_objects` | `bucket`, `keys` (string[]) | `deleteObjects(client, bucket, keys)` | batch delete; surfaces per-key errors |
| `blob_delete_bucket` | `bucket` | `deleteBucket(client, bucket)` | |
| `blob_move_object` | `bucket`, `from`, `to` | `copyObject(...)` then `deleteObjects(client, bucket, [from])` | **destructive** because it deletes the source — never runs under read/write-only policy |

## Safety guards

- **`blob_upload_object` is bounded:** before delegating, reject if the supplied
  `content` exceeds 256 KB (UTF-8 byte length) or if `contentType` is not a
  text-ish type (`text/*`, `application/json`, `application/xml`,
  `application/yaml`, and similar). This stops the AI from smuggling large or
  binary payloads into storage. Rejection throws so the gate records it and the
  driver is never called.
- **Bucket name / object key validation** is delegated to the existing
  `validateBucketName` / `validateObjectKey` already enforced inside the `s3.ts`
  ops. `blob_upload_object` and `blob_move_object` rely on these.
- **`blob_move_object` categorized `destructive`** so it inherits destructive
  permission + confirmation. A copy alone is `write`; the source-delete is what
  makes move destructive.
- **No content / no presigned URL tools** — the metadata-only boundary means no
  object bytes and no unauthenticated download capability ever reach the model
  or the transcript.
- **Standard gate** applies to every tool: `isAllowed(category)` → approval if
  needed → audit log (`~/.baklava/ai-audit/<sessionId>.jsonl`). No extra wiring.

## Testing (`src/lib/ai/tools/blob.test.ts`)

Mirrors `redis.test.ts` / `kubernetes.test.ts`. Mock `@/lib/connections/s3` and
the `blob-registry` client resolver.

- **Category tagging:** assert all 13 tools carry the expected
  read/write/destructive category (esp. `blob_move_object` === destructive,
  `blob_copy_object` === write).
- **Delegation:** each tool calls its `s3.ts` op with the resolved client and
  mapped args (e.g. `blob_list_objects` passes `prefix ?? ""`, `token ?? null`).
- **Upload guard:** `blob_upload_object` rejects a >256 KB body and a
  non-text `contentType` **without** calling `uploadObject`; accepts a small
  text body and calls it with `Buffer.from(content)`.
- **Move semantics:** `blob_move_object` calls `copyObject` then
  `deleteObjects([from])`, in that order.

In `src/lib/ai/tools/registry.test.ts`:
- r2/minio/s3 now return tools (no longer `[]`).
- Default read-only policy exposes only the 5 read tools for a blob tech.
- The existing "unsupported tech returns `[]`" assertion moves to a tech that is
  still unsupported (e.g. `clickhouse`/`elasticsearch`), since r2/minio/s3 are
  now supported.

## Out of scope (deferred)

- Reading object **contents** inline (would require a net-new bounded
  `getObject` op + size/type caps + a `allowBlobObjectRead`-style policy flag).
- **Presigned download URL** generation as a tool (data-egress capability;
  excluded by the metadata-only decision).
- Binary / multipart / large uploads (the UI upload path covers these).

## Files touched

- **New:** `src/lib/ai/tools/blob.ts`, `src/lib/ai/tools/blob.test.ts`
- **Edit:** `src/lib/ai/tools/registry.ts` (BUILDERS), `src/lib/ai/supported.ts`
  (AI_SUPPORTED_TECHS), `src/lib/ai/tools/registry.test.ts` (assertions)

## Verification

`npm run test` + `npm run typecheck` + `npm run lint` + `npm run build` all
green, matching the Phase 1/2 bar.
