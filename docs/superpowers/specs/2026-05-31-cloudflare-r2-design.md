# Cloudflare R2 Workspace — Design

**Date:** 2026-05-31
**Status:** Approved for spec review
**Author:** brainstorming session

## Summary

Add **Cloudflare R2** as the 8th integrated technology in Baklava — the first
**object/blob storage** backend. R2 exposes an S3-compatible API, so the driver
uses the AWS S3 SDK pointed at R2's endpoint. The workspace is a **file manager**:
bucket list → object browser (prefix-as-folder navigation) with upload, download,
delete, copy/rename, object metadata, presigned share links, plus bucket-level
CORS and lifecycle administration.

**Scope decision: R2 only.** This integration is intentionally R2-specific (no
custom-endpoint / region fields, no MinIO/AWS-S3 support). A separate generic-S3
integration may follow later as its own tech.

## Feasibility

Confirmed. R2's S3-compatible API covers everything in scope:

- **Endpoint** is always derived: `https://<accountId>.r2.cloudflarestorage.com`.
- **Region** is fixed to `"auto"` (R2's required value).
- **Auth**: R2 API token → Access Key ID + Secret Access Key (S3 SigV4).
- Supported via S3 API: `ListBuckets`, `CreateBucket`, `DeleteBucket`,
  `ListObjectsV2` (with `Delimiter`/`CommonPrefixes`), `HeadObject`, `GetObject`,
  `PutObject` / multipart, `CopyObject`, `DeleteObjects`, bucket **CORS** and
  **lifecycle** configuration, and presigned URLs.

### Known limitation — public access (assumption, flag during review)

R2's **public access** (the `r2.dev` domain and custom domains) is **not exposed
through the S3 API** — it is only configurable via Cloudflare's REST API, which
requires a *different* credential (a Cloudflare API token, not the S3 keys).

**Decision (v1, assumed):** Bucket administration covers **CORS + lifecycle**.
Public-access is shown **read-only** with an explanatory note and a deep link to
the Cloudflare dashboard. No second credential is introduced.

*Deferred alternative:* add an optional Cloudflare API token field to enable real
public-access management. Out of scope for v1.

## New dependencies

- `@aws-sdk/client-s3` — S3 client + commands.
- `@aws-sdk/s3-request-presigner` — presigned GET URLs.
- `@aws-sdk/lib-storage` — `Upload` helper for streaming multipart uploads.

All three are pure-JS. They likely do **not** need `serverExternalPackages`
registration in `next.config.ts`; add only if Turbopack reports a bundling error.

## Architecture

Follows the existing "add a new technology" pattern (AGENTS.md). No deviation
from established conventions except the new `"Storage"` category and the
object-browser UI shape.

### 1. Connection types — `src/lib/connections/types.ts`

- Add `"r2"` to the `TechId` union.
- New config interface:

```ts
export interface R2Config {
  /** Cloudflare account ID — builds the endpoint
   *  https://<accountId>.r2.cloudflarestorage.com */
  accountId: string;
  /** R2 access key ID (not secret — like a username). */
  accessKeyId: string;
  /** R2 secret access key. Stored as a secret. */
  secretAccessKey: string;
  /** Optional default bucket to open the workspace on. Empty = list all. */
  bucket?: string;
}
```

Region (`"auto"`) and endpoint are derived in the driver — not stored on the
record, since they are fixed for R2.

### 2. Secret handling — `src/lib/connections/store.ts`

Add `"secretAccessKey"` to `SECRET_KEYS`. This makes `redactConfig`/`publicView`
mask it and `mergeConfig` preserve it when the edit form sends a blank value.
`accessKeyId` stays visible (it is an identifier, treated like `user`).

### 3. Summaries — `src/lib/connections/summaries.ts`

```ts
r2: (r) => {
  const cfg = r.config as R2Config;
  const bucket = cfg.bucket ? ` · ${cfg.bucket}` : "";
  return `${cfg.accessKeyId}@${cfg.accountId}.r2${bucket}`;
},
```

### 4. Catalog — `src/lib/tech-catalog.ts`

- Add `"Storage"` to `TechCategory` and `TECH_CATEGORIES`.
- Catalog entry:

```ts
{
  id: "r2",
  name: "Cloudflare R2",
  tagline: "Object storage",
  description:
    "S3-style object browser: buckets, prefix navigation, upload/download, presigned links, CORS and lifecycle.",
  category: "Storage",
  color: "from-orange-400 to-amber-500",
  status: "available",
}
```

- Add `/public/icons/r2.svg` (Cloudflare brand mark) so the icon resolves locally.

### 5. Driver — `src/lib/connections/r2.ts`

A cached `S3Client` per `connectionId`, held on `globalThis` under
`Symbol.for("baklava.r2Clients")` (mirrors the redis/mongo client-cache pattern).
`dropR2Client(id)` destroys it for teardown.

```ts
function clientFor(id: string, cfg: R2Config): S3Client // build-or-reuse
export function dropR2Client(id: string): void
```

Exported operations (each connect-use, no per-call teardown since the client is
cached; all wrapped so callers get `formatError`-friendly errors):

| Function | S3 op |
|---|---|
| `probe(id, cfg)` | `ListBuckets` → `{ buckets: number, account }` |
| `listBuckets(id)` | `ListBuckets` |
| `createBucket(id, name)` | `CreateBucket` (after `validateBucketName`) |
| `deleteBucket(id, name)` | `DeleteBucket` |
| `listObjects(id, bucket, prefix, token)` | `ListObjectsV2` (`Delimiter: "/"`) → `{ folders: CommonPrefixes[], objects[], nextToken }` |
| `headObject(id, bucket, key)` | `HeadObject` → size, contentType, etag, lastModified, metadata, http headers |
| `uploadObject(id, bucket, key, stream)` | `lib-storage` `Upload` (multipart) |
| `copyObject(id, bucket, src, dst)` | `CopyObject` (powers copy / rename / move) |
| `deleteObjects(id, bucket, keys[])` | `DeleteObjects` (bulk) |
| `presignGet(id, bucket, key, ttl)` | presigner → URL |
| `getBucketCors` / `putBucketCors` | `GetBucketCors` / `PutBucketCors` |
| `getBucketLifecycle` / `putBucketLifecycle` | `Get/PutBucketLifecycleConfiguration` |

### 6. Input safety — within `r2.ts`

S3 SDK parameterizes all inputs, so SQL-injection-style concerns do not apply.
The guard is **validation**:

- `validateBucketName(name)` — S3/R2 DNS rules: 3–63 chars, lowercase letters /
  digits / hyphens, must start and end alphanumeric, no consecutive dots, not an
  IP address. Throws on violation.
- Object keys/prefixes: reject empty keys and `..` path-traversal segments before
  issuing requests.

### 7. API routes — `src/app/api/r2/`

All `export const runtime = "nodejs"`; all throws wrapped with `formatError`.

| Route | Methods |
|---|---|
| `test/route.ts` | POST — probe, optional save (mirrors `mongo/test`) |
| `[id]/buckets/route.ts` | GET list · POST create |
| `[id]/buckets/[bucket]/route.ts` | DELETE bucket |
| `[id]/buckets/[bucket]/objects/route.ts` | GET list (`prefix`, `token` query) · DELETE bulk |
| `[id]/buckets/[bucket]/objects/upload/route.ts` | POST — streams request body through `lib-storage` `Upload` |
| `[id]/buckets/[bucket]/objects/download/route.ts` | GET — **302 redirect to a presigned GET URL** (no server memory; large-file safe) |
| `[id]/buckets/[bucket]/objects/meta/route.ts` | GET — `headObject` |
| `[id]/buckets/[bucket]/objects/presign/route.ts` | POST — returns a presigned URL ("copy link") |
| `[id]/buckets/[bucket]/objects/copy/route.ts` | POST — copy / rename / move |
| `[id]/buckets/[bucket]/cors/route.ts` | GET / PUT |
| `[id]/buckets/[bucket]/lifecycle/route.ts` | GET / PUT |

**Cascading delete:** `DELETE /api/connections/[id]` (`src/app/api/connections/[id]/route.ts`)
must call `dropR2Client(id)` alongside the existing teardown calls, and import it.

### 8. Forms & workspace — `src/app/r2/`

- **`r2-form.tsx`** — reused by `ConnectionSheet` and standalone `/r2`. Fields:
  name, account ID, access key ID, secret access key (`type="password"`,
  "(unchanged — leave blank to keep)" edit pattern), optional default bucket.
  Buttons: Test / Test & save; edit mode PATCHes `/api/connections/[id]`.
  Register `R2Form` in the `ConnectionSheet` dispatcher.
- **`[connectionId]/layout.tsx`** — `requireConnection<R2Config>(id, "r2")`,
  renders `<WorkspaceShell tech="r2" …>` with a sidebar: an Overview link plus a
  lazily-loaded bucket list (each bucket links to its browser).
- **`[connectionId]/page.tsx`** — overview: account, derived endpoint, bucket
  count.
- **`[connectionId]/buckets/[bucket]/page.tsx`** + `*-client.tsx` — **the file
  manager**:
  - Breadcrumb prefix navigation (folders are synthetic from `CommonPrefixes`).
  - Table: name, size, last-modified, storage class; folders sort first.
  - Drag-and-drop / picker **upload** with progress; **download** (presigned
    redirect); **copy link** (presigned); **copy / rename / move**; multi-select
    **bulk delete**; "new folder" (zero-byte key with trailing `/`).
  - Object **detail drawer**: metadata + HTTP headers from `headObject`.
  - **Settings tab**: CORS rule editor, lifecycle rule editor, and a read-only
    public-access panel with a Cloudflare-dashboard link (per the limitation
    above).
- **`r2-tabs.tsx`** — per-connection localStorage tab strip
  (`baklava:r2-tabs:${connectionId}`), mirroring `postgres-tabs` / `mongo-tabs`,
  with the same middle-click-close and stale-tab-pruner behavior.

### 9. Tab routing — `src/components/connection-tabs.tsx`

Add `r2: ""` to `FIRST_PAGE` so the workspace tab opens at `/r2/${id}` (overview).

## Data flow

1. **Connect/test**: form → `POST /api/r2/test` → `probe` (`ListBuckets`) →
   optional `saveConnection`. Secret never returned (`publicView`/`redactConfig`).
2. **Browse**: workspace client → `GET /api/r2/[id]/buckets/[bucket]/objects?prefix=…`
   → `ListObjectsV2` with `Delimiter:"/"` → render folders + objects; pagination
   via `nextToken`.
3. **Upload**: client streams file → `POST …/objects/upload` → `lib-storage`
   `Upload` multiparts to R2.
4. **Download / share**: client hits `…/objects/download` → 302 to presigned GET
   (browser fetches directly from R2); "copy link" uses `…/objects/presign`.
5. **Admin**: CORS/lifecycle editors GET then PUT the bucket configuration.

## Error handling

- Every route wraps thrown errors with `formatError` — S3 SDK errors expose a
  useful `name` (`NoSuchBucket`, `AccessDenied`, `NoSuchKey`), which `formatError`
  surfaces.
- `validateBucketName` / key validation throw early with human-readable messages.
- Upload route guards body size only as needed; multipart handles large files.

## Testing

- **Unit (vitest):** `validateBucketName` (accept/reject table), object-key/prefix
  path helpers (folder splitting, `..` traversal rejection), and config building
  in the form/test route.
- **Live smoke:** create a connection against a real R2 account, verify probe,
  bucket list, object upload/list/download/delete, presign, and CORS round-trip
  before merge. (No public mock; R2-only by decision.)
- Verification gates: TypeScript, ESLint, `next build`, live smoke — matching the
  MySQL/Mongo merge bar.

## Out of scope (v1)

- Generic S3 / MinIO / AWS support (separate future integration).
- Public-access management (deferred; needs a Cloudflare API token).
- Bucket replication, event notifications, object versioning UI, Workers bindings.
- Direct browser→R2 presigned-PUT upload (server-side streaming is simpler and
  CORS-free for v1; can revisit for very large uploads).

## File inventory

**New:**
`src/lib/connections/r2.ts`,
`src/app/r2/r2-form.tsx`,
`src/app/r2/[connectionId]/{layout,page}.tsx`,
`src/app/r2/[connectionId]/r2-sidebar.tsx`,
`src/app/r2/[connectionId]/r2-tabs.tsx`,
`src/app/r2/[connectionId]/buckets/[bucket]/{page,*-client}.tsx`,
`src/app/api/r2/test/route.ts` and the `[id]/buckets/...` route tree above,
`public/icons/r2.svg`,
`src/lib/connections/r2.test.ts`.

**Modified:**
`src/lib/connections/types.ts` (+`R2Config`, `r2` TechId),
`src/lib/connections/store.ts` (+`secretAccessKey` in `SECRET_KEYS`),
`src/lib/connections/summaries.ts` (+`r2`),
`src/lib/tech-catalog.ts` (+`Storage` category, +`r2` entry),
`src/components/connection-tabs.tsx` (+`r2` in `FIRST_PAGE`),
`src/app/api/connections/[id]/route.ts` (+`dropR2Client` teardown),
`ConnectionSheet` dispatcher (+`R2Form`),
`next.config.ts` (only if Turbopack requires externalizing the AWS SDK).
