# MinIO via a Shared S3 Blob-Storage Core — Design

**Date:** 2026-06-01
**Status:** Approved for spec review
**Builds on:** `docs/superpowers/specs/2026-05-31-cloudflare-r2-design.md` (R2 shipped to `main`)

## Summary

Add **MinIO** (self-hosted S3-compatible object storage) as Baklava's 9th
technology. MinIO and the just-shipped R2 are both S3-compatible, so rather than
duplicate R2's ~410-line driver, 11 routes, and ~1,100-line workspace, we
**extract the shared S3 logic into reusable modules** and make both R2 and MinIO
thin consumers.

Two phases:
- **Phase A — Extract (behavior-preserving):** move R2's S3 operations, route
  logic, and workspace UI into shared modules; refactor R2 to consume them. R2's
  observable behavior is unchanged and re-verified.
- **Phase B — Add MinIO:** a config type, a client builder, a form, thin route
  re-exports, and thin workspace wrappers.

## Feasibility

Confirmed. MinIO speaks the same S3 API R2 does; every operation already built
for R2 (`ListBuckets`, `ListObjectsV2` with delimiter, `HeadObject`, multipart
`Upload`, `CopyObject`, `DeleteObjects`, presigned GET, bucket CORS + lifecycle)
works against MinIO. The only differences are at client construction:

| | R2 | MinIO |
|---|---|---|
| Endpoint | derived `https://<accountId>.r2.cloudflarestorage.com` | user-supplied `host:port` or full URL |
| Region | `"auto"` | real region, default `us-east-1` |
| Addressing | virtual-host (default) | **path-style** (`forcePathStyle: true`) |
| Credentials | accessKeyId / secretAccessKey | accessKey / secretKey |

## Architecture

### 1. Shared driver core — `src/lib/connections/s3.ts` (new)

Everything tech-agnostic moves here out of `r2.ts`:

- **Pure helpers:** `validateBucketName`, `validateObjectKey`, `splitKey`,
  `joinPrefix` (unchanged logic).
- **Result types:** `BucketInfo`, `ObjectEntry`, `ObjectListing`, `ObjectMeta`.
- **Operations — each takes an `S3Client` as its first arg** (no per-tech config
  inside): `probe(client)`, `listBuckets(client)`, `createBucket(client,name)`,
  `deleteBucket(client,name)`, `listObjects(client,bucket,prefix,token)`,
  `headObject(client,bucket,key)`, `uploadObject(client,bucket,key,body,ct)`,
  `copyObject(client,bucket,src,dst)`, `deleteObjects(client,bucket,keys)`,
  `presignGet(client,bucket,key,ttl)`, `getBucketCors`/`putBucketCors`,
  `getBucketLifecycle`/`putBucketLifecycle`.
- **Generic client cache:** `getCachedClient(cacheKey, hash, build)` and
  `dropCachedClient(cacheKey)` held on `globalThis[Symbol.for("baklava.s3Clients")]`,
  keyed by `${tech}:${connectionId}`. Rebuilds + destroys stale client on hash
  change (same semantics as R2's current cache).

### 2. Per-tech client builders

- **`r2.ts`** shrinks to: `clientFor(id, cfg: R2Config): S3Client` (derived
  endpoint, region `"auto"`, hash over accountId/keys) using
  `getCachedClient("r2:"+id, …)`, and `dropR2Client(id)` →
  `dropCachedClient("r2:"+id)`. It re-exports the shared helpers it previously
  owned so existing imports keep working where cheap, but routes will import from
  the registry/shared core directly (see below).
- **`minio.ts`** (new): `clientFor(id, cfg: MinioConfig): S3Client` building an
  `S3Client` with `endpoint` (resolved from `MinioConfig` — see §6),
  `region: cfg.region || "us-east-1"`, `forcePathStyle: true`, credentials
  `{accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey}`, 15s request
  timeout. `dropMinioClient(id)` → `dropCachedClient("minio:"+id)`.

### 3. Blob registry — `src/lib/connections/blob-registry.ts` (new)

Lets shared code resolve either tech:

```ts
export interface BlobTech {
  tech: TechId;
  clientFor(id: string, cfg: unknown): S3Client;
  dropClient(id: string): void;
  /** returns an error string, or null when valid */
  validateConfig(cfg: unknown): string | null;
  /** default connection name for save */
  defaultName: string;
}
export const BLOB_TECHS: Partial<Record<TechId, BlobTech>> = { r2: …, minio: … };
export function blobTech(tech: string): BlobTech | undefined;
```

`validateConfig` holds each tech's required-field checks (R2: accountId +
accessKeyId + secretAccessKey; MinIO: endpoint + accessKey + secretKey).

### 4. Shared route handlers — `src/lib/connections/blob-handlers.ts` (new)

A factory returns Next route handlers bound to a tech:

```ts
export function blobHandlers(tech: TechId) {
  // resolves connection via getConnection(id), guards rec.tech === tech,
  // gets client via blobTech(tech).clientFor(id, rec.config),
  // calls the shared s3.ts op, wraps errors with formatError.
  return { listBuckets, createBucket, deleteBucket, listObjects, bulkDelete,
           upload, download, meta, presign, copy, getCors, putCors,
           getLifecycle, putLifecycle, test };
}
```

Each of the 11 route files per tech becomes a thin re-export, e.g.
`src/app/api/minio/[id]/buckets/[bucket]/objects/route.ts`:

```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
const h = blobHandlers("minio");
export const GET = h.listObjects;
export const DELETE = h.bulkDelete;
```

R2's existing 11 route files are rewritten to the same thin form
(`blobHandlers("r2")`), so route logic lives in exactly one place. The `test`
handler uses `blobTech(tech).validateConfig` + `defaultName` and saves with the
correct `tech`.

### 5. Shared workspace UI — `src/components/blob/` (new)

Move R2's workspace components here, parameterized by `tech`:

- `object-browser.tsx`, `bucket-sidebar.tsx`, `bucket-tabs.tsx`,
  `bucket-client.tsx`, `bucket-settings.tsx` — props gain `tech: TechId`;
  `apiBase` becomes `/api/${tech}/${id}/…`; the tab localStorage key becomes
  `baklava:${tech}-tabs:${connectionId}`.
- Per-tech route pages stay (Next needs them) but become thin wrappers:
  - `src/app/<tech>/[connectionId]/layout.tsx` — `requireConnection`, builds the
    `WorkspaceShell` + `<BucketSidebar tech …>` + `<BucketTabs tech …>`.
  - `…/page.tsx` — overview (account/endpoint/bucket count).
  - `…/buckets/[bucket]/page.tsx` — renders `<BucketClient tech …>`.
- R2's `src/app/r2/[connectionId]/r2-sidebar.tsx`, `r2-tabs.tsx`, and
  `buckets/[bucket]/{bucket-client,object-browser,bucket-settings}.tsx` are
  **deleted** (moved to `src/components/blob/`); R2's thin pages import the shared
  components.

The overview differs slightly per tech (R2 shows account id; MinIO shows
endpoint), so the overview stays a small per-tech page rather than shared.

### 6. MinIO config + endpoint resolution

```ts
export interface MinioConfig {
  /** "host:port" or a full "http(s)://host:port" URL. */
  endpoint: string;
  /** Used only when `endpoint` has no scheme. */
  useSSL: boolean;
  accessKey: string;
  secretKey: string; // SECRET
  /** S3 region; default "us-east-1". */
  region: string;
  bucket?: string;
}
```

`resolveEndpoint(cfg)` (in `minio.ts`, unit-tested): if `endpoint` already starts
with `http://`/`https://`, use it verbatim; otherwise prefix
`cfg.useSSL ? "https://" : "http://"`. This satisfies the "both input styles"
decision with a single field + toggle.

### 7. Tech wiring (MinIO)

- `types.ts`: `"minio"` in `TechId`; `MinioConfig`.
- `store.ts`: add `"secretKey"` to `SECRET_KEYS`.
- `tech-catalog.ts`: `minio` entry, category `"Storage"`, MinIO-red gradient
  (`from-red-400 to-rose-600`), `status: "available"`.
- `summaries.ts`: `minio` → `accessKey@endpoint · bucket`.
- `connection-tabs.tsx`: `minio: ""` in `FIRST_PAGE`; add `minio` (and confirm
  `r2`) to the active-tab regex.
- `connection-sheet.tsx`: register `MinioForm`.
- `api/connections/[id]/route.ts`: call `dropMinioClient(id)` in the cascading
  delete.
- `public/icons/minio.svg`.

### 8. MinIO form — `src/app/minio/minio-form.tsx`

Fields: name, Endpoint (placeholder `localhost:9000`), **Use SSL** — a shadcn
`Switch` (`@/components/ui/switch`, already present in the repo) with a label,
Access Key, Secret Key (`type="password"`, "(unchanged — leave blank to keep)"
edit pattern), Region (default `us-east-1`), optional default bucket.
Test / Test & save / edit-mode PATCH — mirrors `r2-form` structure.

## Data flow

Identical to R2: form → `POST /api/minio/test` (probe via shared `probe`) →
optional save. Browse/upload/download/presign/admin all route through
`blobHandlers("minio")` → `blobTech("minio").clientFor` → shared `s3.ts` op.

## Error handling

- Shared handlers wrap every throw with `formatError`; read ops → 500, mutations
  → 400, missing/mismatched connection → 404, bad JSON/multipart → 400 (matching
  R2's contract exactly, since it's now the same code).
- `validateBucketName` / `validateObjectKey` throw early; MinIO endpoint typos
  surface as connection errors via `formatError`.

## Testing

- **Unit (vitest):** `s3.test.ts` (the moved helper tests — accept/reject tables,
  path helpers) + `minio.test.ts` (`resolveEndpoint`: bare host, host:port, full
  http URL, full https URL, scheme overrides toggle; `validateConfig`).
- **R2 regression (behavior-preserving):** after Phase A, run `tsc`, `lint`,
  `vitest`, `build`, and a **live R2 browser smoke** (create connection → upload
  via the file picker → see it listed → download) to prove the extraction didn't
  change R2 behavior.
- **MinIO live smoke:** spin up `docker run -p 9000:9000 minio/minio server /data`
  (creds `minioadmin`/`minioadmin`), create a bucket, then exercise create
  connection → create bucket → upload → list → download → presign → delete →
  CORS round-trip, via the API and the browser file picker. Tear the container
  down after.

## Out of scope (v1)

- AWS S3 proper as its own tech (MinIO already covers generic S3-compatible
  endpoints; a dedicated AWS tech with profiles/STS can come later).
- Public-access management (same R2 limitation note does not apply to MinIO;
  MinIO bucket policies are deferred — settings stay CORS + lifecycle, matching
  R2's surface for consistency).
- Versioning UI, replication, IAM/policy editing.

## File inventory

**New:**
`src/lib/connections/s3.ts`, `src/lib/connections/s3.test.ts`,
`src/lib/connections/minio.ts`, `src/lib/connections/minio.test.ts`,
`src/lib/connections/blob-registry.ts`, `src/lib/connections/blob-handlers.ts`,
`src/components/blob/{object-browser,bucket-sidebar,bucket-tabs,bucket-client,bucket-settings}.tsx`,
`src/app/minio/minio-form.tsx`,
`src/app/minio/[connectionId]/{layout,page}.tsx`,
`src/app/minio/[connectionId]/buckets/[bucket]/page.tsx`,
`src/app/api/minio/test/route.ts` and the `[id]/buckets/…` route tree (11 files),
`public/icons/minio.svg`.

**Modified (Phase A — R2 refactor):**
`src/lib/connections/r2.ts` (shrink to client builder, delegate to `s3.ts`),
all 11 `src/app/api/r2/**/route.ts` (thin re-exports via `blobHandlers("r2")`),
`src/app/r2/[connectionId]/{layout,page}.tsx` + `buckets/[bucket]/page.tsx` (use
shared components), and **delete** R2's `r2-sidebar.tsx`, `r2-tabs.tsx`,
`buckets/[bucket]/{bucket-client,object-browser,bucket-settings}.tsx`.
Move `r2.test.ts` helper cases into `s3.test.ts`.

**Modified (Phase B — wiring):**
`types.ts`, `store.ts`, `tech-catalog.ts`, `summaries.ts`,
`connection-tabs.tsx`, `connection-sheet.tsx`,
`src/app/api/connections/[id]/route.ts`.
