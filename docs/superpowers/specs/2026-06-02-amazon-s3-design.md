# Amazon S3 — Design (thin consumer of the shared blob/S3 core)

**Date:** 2026-06-02
**Status:** Approved for spec review
**Builds on:** `docs/superpowers/specs/2026-06-01-minio-shared-s3-core-design.md` (shared core shipped: `s3.ts` ops, `blob-registry.ts`, `blob-handlers.ts`, `src/components/blob/*`).

## Summary

Add **Amazon S3** as Baklava's 10th technology — the third consumer of the shared
S3 blob-storage core (after R2 and MinIO). Because the core was built for exactly
this, S3 adds **no new operation, route, or UI logic** — only a config type, a
client builder, a registry entry, a form, thin route re-exports, thin workspace
pages, and per-tech wiring.

S3 differs from R2/MinIO only in client construction: AWS derives the endpoint
from the **region** (no user endpoint), uses **virtual-host addressing**
(`forcePathStyle: false`, the default), and optionally accepts a **session token**
for temporary STS credentials. S3 fully supports the S3 CORS + lifecycle APIs.

## Config + secrets

```ts
export interface S3Config {
  /** AWS region, e.g. "us-east-1". Drives the endpoint. */
  region: string;
  accessKeyId: string;
  secretAccessKey: string; // SECRET (already in SECRET_KEYS)
  /** Optional temporary-credential session token. */
  sessionToken?: string;   // SECRET
  bucket?: string;
}
```

- `TechId += "s3"`.
- `SECRET_KEYS += "sessionToken"` (`secretAccessKey` is already present from R2, so
  it's already redacted/preserved).

## Client builder — `src/lib/connections/s3-aws.ts`

Named `s3-aws.ts` to avoid colliding with the shared core `s3.ts`.

```ts
export function endpointFor(region: string): string {
  return `https://s3.${region}.amazonaws.com`; // display only
}
export function s3AwsClientFor(id: string, cfg: S3Config): S3Client {
  return getCachedClient(
    `s3:${id}`,
    JSON.stringify([cfg.region, cfg.accessKeyId, cfg.secretAccessKey, cfg.sessionToken ?? ""]),
    () => new S3Client({
      region: cfg.region || "us-east-1",
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
        sessionToken: cfg.sessionToken || undefined,
      },
      requestHandler: { requestTimeout: 15_000 },
      // no endpoint → SDK derives from region; virtual-host addressing (default)
    }),
  );
}
export function dropS3Client(id: string): void { dropCachedClient(`s3:${id}`); }
```

No `endpoint`, no `forcePathStyle` (defaults to false / virtual-host).

## Registry entry — `blob-registry.ts`

```ts
s3: {
  tech: "s3",
  clientFor: (id, cfg) => s3AwsClientFor(id, cfg as S3Config),
  dropClient: dropS3Client,
  validateConfig: (cfg) => {
    const c = cfg as S3Config;
    if (!c?.region?.trim()) return "Region is required";
    if (!c?.accessKeyId?.trim() || !c?.secretAccessKey)
      return "Access Key ID and Secret Access Key are required";
    return null;
  },
  endpointOf: (cfg) => endpointFor((cfg as S3Config).region),
  defaultName: "Amazon S3",
},
```

## Reused with zero new logic

- **API routes:** 11 thin files under `src/app/api/s3/**` → `blobHandlers("s3").<handler>` (mirror R2/MinIO route files, swap the tech literal).
- **Workspace:** `src/app/s3/[connectionId]/{layout,page}.tsx` + `buckets/[bucket]/page.tsx` — thin pages passing `tech="s3"` to the shared `BucketSidebar`/`BucketTabs`/`BucketClient`. Overview shows region + endpoint + bucket count.
- **Form:** `src/app/s3/s3-form.tsx` — mirrors `r2-form` with fields: name, Region (default `us-east-1`), Access Key ID, Secret Access Key (password, "(unchanged — leave blank to keep)"), Session Token (password, optional, same unchanged-blank treatment), default bucket. Posts to `/api/s3/test`; edit → PATCH.

## Per-tech wiring

- `tech-catalog.ts`: `s3` entry — name "Amazon S3", tagline "Object storage", category `"Storage"`, AWS-green gradient `from-green-500 to-teal-600`, `status: "available"`.
- `summaries.ts`: `s3` → `${accessKeyId}@s3.${region}${bucket-suffix}`.
- `connection-tabs.tsx`: `FIRST_PAGE.s3 = ""`; add `s3` to the `activeIdFromPath` regex alternation.
- `connection-sheet.tsx`: register `S3Form`.
- `api/connections/[id]/route.ts`: call `dropS3Client(id)` in the cascading delete.
- `public/icons/s3.svg`.

## Settings tab — extend `bucket-settings.tsx` tech-awareness

Current behavior: `minio` → CORS info note (MinIO lacks the S3 CORS API); `r2` →
Cloudflare public-access note. Extend to a clean per-tech model:

- **CORS section:** editor for `r2` and `s3` (both support PutBucketCors); info note
  for `minio`.
- **Public-access note (per-tech):**
  - `r2` → Cloudflare-dashboard note (unchanged).
  - `s3` → AWS-console note: "S3 public access is governed by Block Public Access
    and bucket policies, managed in the AWS console" + link to
    `https://s3.console.aws.amazon.com/s3/buckets`.
  - `minio` → none.
- **Lifecycle editor:** all three.

Implementation: replace the two ad-hoc conditionals with small per-tech maps (a
`CORS_SUPPORTED: Set<TechId>` / a `publicAccessNote: Partial<Record<TechId, {text, href, linkLabel}>>`), so adding S3 is data, not new branches.

## Error handling / data flow

Identical to R2/MinIO — all through `blobHandlers("s3")` → `s3AwsClientFor` →
shared `s3.ts` ops, wrapped with `formatError`. AWS region/credential errors
surface via `formatError` (e.g. `AuthorizationHeaderMalformed`,
`InvalidAccessKeyId`, `PermanentRedirect` for wrong-region).

## Testing

- **Unit (vitest):** `s3-aws.test.ts` — `endpointFor` (region → URL), and the
  config hash/credential wiring incl. optional `sessionToken` (token present vs
  absent yields different hashes; `sessionToken: undefined` when blank).
- **Static gates:** tsc, lint, `vitest run`, `npm run build` (confirm `/s3` +
  `/api/s3/**` routes registered).
- **No live AWS smoke** (decision): S3 is a thin consumer of the shared core
  already live-smoked end-to-end via R2 (real Cloudflare bucket) and MinIO (local
  container). The user runs a live AWS smoke later with their own throwaway keys.
- Code review (spec + quality + a final whole-branch review), as with R2/MinIO.

## Out of scope (v1)

- Custom endpoint override / FIPS / GovCloud / VPC endpoints (MinIO covers generic
  S3-compatible endpoints; AWS-proper here is region-derived).
- AWS profiles / SSO / instance-role credential providers (keys + optional session
  token only).
- Block-Public-Access / bucket-policy editing (info note only).

## File inventory

**New:**
`src/lib/connections/s3-aws.ts`, `src/lib/connections/s3-aws.test.ts`,
`src/app/s3/s3-form.tsx`,
`src/app/s3/[connectionId]/{layout,page}.tsx`,
`src/app/s3/[connectionId]/buckets/[bucket]/page.tsx`,
`src/app/api/s3/test/route.ts` + the `[id]/buckets/…` route tree (11 files),
`public/icons/s3.svg`.

**Modified:**
`src/lib/connections/types.ts` (+`S3Config`, `s3` TechId),
`src/lib/connections/store.ts` (+`sessionToken` in `SECRET_KEYS`),
`src/lib/connections/blob-registry.ts` (+`s3` entry),
`src/lib/tech-catalog.ts` (+`s3`), `src/lib/connections/summaries.ts` (+`s3`),
`src/components/connection-tabs.tsx` (+`s3`),
`src/components/connection-sheet.tsx` (+`S3Form`),
`src/app/api/connections/[id]/route.ts` (+`dropS3Client`),
`src/components/blob/bucket-settings.tsx` (per-tech CORS/public-access model + S3).
