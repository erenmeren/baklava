# Cloudflare R2 Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare R2 as Baklava's 8th technology — an object-storage workspace with a bucket list and a file-manager (prefix browser, upload/download/delete/copy, presigned links, CORS + lifecycle admin).

**Architecture:** R2 is S3-compatible, so a cached `@aws-sdk/client-s3` `S3Client` per connection (mirroring the Mongo client-cache) drives all operations against `https://<accountId>.r2.cloudflarestorage.com` (region `auto`). Server API routes wrap the driver with `formatError`; the workspace follows the established `requireConnection` → `WorkspaceShell` + sidebar + tab-strip pattern. Downloads use presigned-GET redirects (no server memory); uploads stream through `@aws-sdk/lib-storage`.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@aws-sdk/lib-storage`, base-ui/shadcn, vitest.

**Reference spec:** `docs/superpowers/specs/2026-05-31-cloudflare-r2-design.md`

**Scope decision:** R2 only — no region/endpoint config fields, no MinIO/AWS-S3. Public-access is read-only info (option A); CORS + lifecycle are editable.

**Test credentials (already verified live):** account `8df1045d97ff80861a1278eb2c88a17e`, accessKeyId `6d9ca113d74103d74ae17b7480ac204c`, bucket `ditto-receipts`. Rotate after testing.

---

## File Structure

**New files:**
- `src/lib/connections/r2.ts` — S3 client cache, validation helpers, all R2 operations.
- `src/lib/connections/r2.test.ts` — unit tests for pure helpers.
- `src/app/r2/r2-form.tsx` — connection form (sheet + standalone).
- `src/app/r2/[connectionId]/layout.tsx` — workspace shell + sidebar + tabs.
- `src/app/r2/[connectionId]/page.tsx` — overview.
- `src/app/r2/[connectionId]/r2-sidebar.tsx` — bucket list sidebar.
- `src/app/r2/[connectionId]/r2-tabs.tsx` — per-connection tab strip.
- `src/app/r2/[connectionId]/buckets/[bucket]/page.tsx` — bucket server page.
- `src/app/r2/[connectionId]/buckets/[bucket]/bucket-client.tsx` — Objects/Settings tab shell.
- `src/app/r2/[connectionId]/buckets/[bucket]/object-browser.tsx` — the file manager.
- `src/app/r2/[connectionId]/buckets/[bucket]/bucket-settings.tsx` — CORS, lifecycle, public-access info.
- `src/app/api/r2/test/route.ts`
- `src/app/api/r2/[id]/buckets/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/objects/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/objects/upload/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/objects/download/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/objects/meta/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/objects/presign/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/objects/copy/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/cors/route.ts`
- `src/app/api/r2/[id]/buckets/[bucket]/lifecycle/route.ts`
- `public/icons/r2.svg`

**Modified files:**
- `src/lib/connections/types.ts` — `R2Config` + `"r2"` TechId.
- `src/lib/connections/store.ts:152` — add `"secretAccessKey"` to `SECRET_KEYS`.
- `src/lib/connections/summaries.ts` — `r2` summary.
- `src/lib/tech-catalog.ts` — `"Storage"` category + `r2` entry.
- `src/components/connection-tabs.tsx:16` — `r2` in `FIRST_PAGE`.
- `src/components/connection-sheet.tsx` — register `R2Form`.
- `src/app/api/connections/[id]/route.ts` — `dropR2Client` teardown.
- `package.json` — three AWS SDK deps (already installed during brainstorming; verify present).

---

## Phase 0 — Registration & config wiring

### Task 0.1: Verify AWS SDK dependencies present

**Files:** Modify: `package.json`

- [ ] **Step 1: Confirm deps installed** (added during brainstorming)

Run: `node -e "require('@aws-sdk/client-s3');require('@aws-sdk/s3-request-presigner');require('@aws-sdk/lib-storage');console.log('ok')"`
Expected: `ok`. If it errors, run:
`npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage`

- [ ] **Step 2: Commit lockfile**

```bash
git add package.json package-lock.json
git commit -m "build: add AWS S3 SDK deps for R2 workspace"
```

### Task 0.2: Add R2Config and TechId

**Files:** Modify: `src/lib/connections/types.ts`

- [ ] **Step 1: Add `"r2"` to the TechId union** (append after `"mongo"`)

```ts
export type TechId =
  | "docker"
  | "kafka"
  | "postgres"
  | "mysql"
  | "sqlserver"
  | "kubernetes"
  | "redis"
  | "mongo"
  | "r2";
```

- [ ] **Step 2: Append the `R2Config` interface** at the end of the file

```ts
export interface R2Config {
  /**
   * Cloudflare account ID. The S3 endpoint is derived as
   * `https://<accountId>.r2.cloudflarestorage.com`; region is always "auto".
   */
  accountId: string;
  /** R2 access key ID. Not a secret — treated like a username. */
  accessKeyId: string;
  /** R2 secret access key. Stored as a secret (see SECRET_KEYS). */
  secretAccessKey: string;
  /** Optional default bucket to open the workspace on. Empty = list all. */
  bucket?: string;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `summaries.ts` / `tech-catalog.ts` / `connection-tabs.tsx` (missing `r2` key) — those are fixed in the next tasks. No error in `types.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/connections/types.ts
git commit -m "feat(r2): add R2Config type and r2 TechId"
```

### Task 0.3: Mark secretAccessKey as a secret

**Files:** Modify: `src/lib/connections/store.ts:152-160`

- [ ] **Step 1: Add the key to the set**

Change the `SECRET_KEYS` set to include `"secretAccessKey"`:

```ts
const SECRET_KEYS = new Set([
  "password",
  "apiKey",
  "serviceRoleKey",
  "token",
  "authToken",
  "kubeconfigYaml",
  "uri",
  "secretAccessKey",
]);
```

- [ ] **Step 2: Run the store tests to confirm no regression**

Run: `npx vitest run src/lib/connections/store.test.ts`
Expected: PASS (existing assertions don't involve `secretAccessKey`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/connections/store.ts
git commit -m "feat(r2): redact secretAccessKey in connection store"
```

### Task 0.4: Catalog entry + Storage category

**Files:** Modify: `src/lib/tech-catalog.ts`

- [ ] **Step 1: Add `"Storage"` to the category type and list**

```ts
export type TechCategory =
  | "Runtime"
  | "Database"
  | "Streaming"
  | "Orchestration"
  | "Cache"
  | "Storage";

export const TECH_CATEGORIES = [
  "All",
  "Runtime",
  "Database",
  "Streaming",
  "Orchestration",
  "Cache",
  "Storage",
] as const;
```

- [ ] **Step 2: Append the catalog entry** to `TECH_CATALOG` (after the `mongo` entry)

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
  },
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/tech-catalog.ts
git commit -m "feat(r2): register Cloudflare R2 in tech catalog (Storage category)"
```

### Task 0.5: Connection summary

**Files:** Modify: `src/lib/connections/summaries.ts`

- [ ] **Step 1: Import `R2Config`** — add `R2Config` to the type import block.

- [ ] **Step 2: Add the `r2` summary** to the `connectionSummaries` object

```ts
  r2: (r) => {
    const cfg = r.config as R2Config;
    const bucket = cfg.bucket ? ` · ${cfg.bucket}` : "";
    return `${cfg.accessKeyId}@${cfg.accountId}.r2${bucket}`;
  },
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` should now no longer complain about `summaries.ts` missing the `r2` key.

- [ ] **Step 4: Commit**

```bash
git add src/lib/connections/summaries.ts
git commit -m "feat(r2): add R2 connection summary"
```

### Task 0.6: First-page routing

**Files:** Modify: `src/components/connection-tabs.tsx:16-25`

- [ ] **Step 1: Add `r2` to `FIRST_PAGE`** (empty string → opens at `/r2/<id>` overview)

```ts
const FIRST_PAGE: Record<TechId, string> = {
  docker: "containers",
  postgres: "",
  mysql: "",
  kafka: "",
  sqlserver: "",
  kubernetes: "pods",
  redis: "keys",
  mongo: "databases",
  r2: "",
};
```

- [ ] **Step 2: Commit**

```bash
git add src/components/connection-tabs.tsx
git commit -m "feat(r2): route R2 workspace tab to overview"
```

### Task 0.7: Brand icon

**Files:** Create: `public/icons/r2.svg`

- [ ] **Step 1: Write the Cloudflare-mark SVG**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="Cloudflare R2">
  <path d="M16.5 16.5H6.2a2.7 2.7 0 0 1-.5-5.36 4.2 4.2 0 0 1 8.04-1.86 3 3 0 0 1 4.43 2.05 2.6 2.6 0 0 1-1.67 5.03Z" opacity=".9"/>
  <text x="12" y="22" font-family="monospace" font-size="6" font-weight="700" text-anchor="middle">R2</text>
</svg>
```

- [ ] **Step 2: Verify it loads** — start `npm run dev`, open `http://localhost:3000/icons/r2.svg`. Expected: SVG renders.

- [ ] **Step 3: Commit**

```bash
git add public/icons/r2.svg
git commit -m "feat(r2): add R2 brand icon"
```

---

## Phase 1 — Driver (`src/lib/connections/r2.ts`)

### Task 1.1: Validation & path helpers (TDD)

**Files:** Create: `src/lib/connections/r2.ts`, `src/lib/connections/r2.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/connections/r2.test.ts
import { describe, it, expect } from "vitest";
import {
  validateBucketName,
  validateObjectKey,
  endpointFor,
  splitKey,
  joinPrefix,
} from "./r2";

describe("validateBucketName", () => {
  it("accepts valid names", () => {
    expect(() => validateBucketName("ditto-receipts")).not.toThrow();
    expect(() => validateBucketName("my-bucket-123")).not.toThrow();
  });
  it("rejects too short / too long", () => {
    expect(() => validateBucketName("ab")).toThrow();
    expect(() => validateBucketName("a".repeat(64))).toThrow();
  });
  it("rejects uppercase, spaces, underscores", () => {
    expect(() => validateBucketName("MyBucket")).toThrow();
    expect(() => validateBucketName("my bucket")).toThrow();
    expect(() => validateBucketName("my_bucket")).toThrow();
  });
  it("rejects names not starting/ending alphanumeric", () => {
    expect(() => validateBucketName("-bucket")).toThrow();
    expect(() => validateBucketName("bucket-")).toThrow();
  });
  it("rejects consecutive dots and IP-shaped names", () => {
    expect(() => validateBucketName("a..b")).toThrow();
    expect(() => validateBucketName("192.168.0.1")).toThrow();
  });
});

describe("validateObjectKey", () => {
  it("accepts normal keys", () => {
    expect(() => validateObjectKey("a/b/c.txt")).not.toThrow();
    expect(() => validateObjectKey("photo.jpg")).not.toThrow();
  });
  it("rejects empty and traversal", () => {
    expect(() => validateObjectKey("")).toThrow();
    expect(() => validateObjectKey("../etc/passwd")).toThrow();
    expect(() => validateObjectKey("a/../../b")).toThrow();
  });
});

describe("endpointFor", () => {
  it("builds the R2 endpoint from account id", () => {
    expect(endpointFor("abc123")).toBe(
      "https://abc123.r2.cloudflarestorage.com",
    );
  });
});

describe("splitKey", () => {
  it("splits a key into prefix folders and basename", () => {
    expect(splitKey("a/b/c.txt")).toEqual({
      folders: ["a", "b"],
      name: "c.txt",
    });
    expect(splitKey("file.txt")).toEqual({ folders: [], name: "file.txt" });
  });
});

describe("joinPrefix", () => {
  it("joins a prefix and a name with a single slash", () => {
    expect(joinPrefix("a/b/", "c.txt")).toBe("a/b/c.txt");
    expect(joinPrefix("", "c.txt")).toBe("c.txt");
    expect(joinPrefix("a/b", "c.txt")).toBe("a/b/c.txt");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/connections/r2.test.ts`
Expected: FAIL — module `./r2` has no such exports.

- [ ] **Step 3: Write the helpers** — create `src/lib/connections/r2.ts` with the file header and pure helpers (driver operations come in the next task)

```ts
import "server-only";
import {
  S3Client,
  ListBucketsCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  type CORSRule,
  type LifecycleRule,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import type { R2Config } from "./types";

// ── Pure helpers ────────────────────────────────────────────────────────────

export function endpointFor(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Enforce S3/R2 bucket DNS naming rules. Throws on violation. */
export function validateBucketName(name: string): void {
  if (name.length < 3 || name.length > 63) {
    throw new Error("Bucket name must be 3–63 characters.");
  }
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
    throw new Error(
      "Bucket name may contain only lowercase letters, digits, hyphens and dots, and must start and end alphanumeric.",
    );
  }
  if (name.includes("..")) {
    throw new Error("Bucket name must not contain consecutive dots.");
  }
  if (IP_RE.test(name)) {
    throw new Error("Bucket name must not be formatted as an IP address.");
  }
}

/** Reject empty keys and path-traversal segments. Throws on violation. */
export function validateObjectKey(key: string): void {
  if (!key || !key.trim()) throw new Error("Object key is required.");
  if (key.split("/").some((seg) => seg === "..")) {
    throw new Error("Object key must not contain '..' path segments.");
  }
}

/** Split an object key into its folder segments and basename. */
export function splitKey(key: string): { folders: string[]; name: string } {
  const parts = key.split("/");
  const name = parts.pop() ?? "";
  return { folders: parts.filter(Boolean), name };
}

/** Join a prefix and a name with exactly one slash between them. */
export function joinPrefix(prefix: string, name: string): string {
  if (!prefix) return name;
  return `${prefix.replace(/\/+$/, "")}/${name}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/connections/r2.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/r2.ts src/lib/connections/r2.test.ts
git commit -m "feat(r2): bucket/key validation and path helpers with tests"
```

### Task 1.2: S3 client cache + operations

**Files:** Modify: `src/lib/connections/r2.ts`

- [ ] **Step 1: Append the client cache** (mirrors `mongo.ts` `getCache`/`dropMongoClient`)

```ts
// ── Client cache ──────────────────────────────────────────────────────────────

interface ClientBundle {
  hash: string;
  client: S3Client;
}

const globalKey = Symbol.for("baklava.r2Clients");

function getCache(): Map<string, ClientBundle> {
  const g = globalThis as unknown as Record<symbol, Map<string, ClientBundle>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

function hashConfig(cfg: R2Config): string {
  return JSON.stringify([cfg.accountId, cfg.accessKeyId, cfg.secretAccessKey]);
}

function clientFor(connectionId: string, cfg: R2Config): S3Client {
  const cache = getCache();
  const hash = hashConfig(cfg);
  const cached = cache.get(connectionId);
  if (cached && cached.hash === hash) return cached.client;
  if (cached) cached.client.destroy();
  const client = new S3Client({
    region: "auto",
    endpoint: endpointFor(cfg.accountId),
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    requestHandler: { requestTimeout: 15_000 },
  });
  cache.set(connectionId, { hash, client });
  return client;
}

export function dropR2Client(connectionId: string): void {
  const cache = getCache();
  const cached = cache.get(connectionId);
  if (!cached) return;
  try {
    cached.client.destroy();
  } catch {
    // ignore
  }
  cache.delete(connectionId);
}
```

- [ ] **Step 2: Append the result-shape types and operations**

```ts
// ── Shapes ──────────────────────────────────────────────────────────────────

export interface ProbeResult {
  ok: true;
  buckets: number;
  endpoint: string;
}

export interface BucketInfo {
  name: string;
  createdAt: number | null;
}

export interface ObjectEntry {
  key: string;
  /** Basename relative to the listing prefix. */
  name: string;
  size: number;
  lastModified: number | null;
  storageClass: string | null;
}

export interface ObjectListing {
  prefix: string;
  folders: string[]; // full prefixes ending in "/"
  objects: ObjectEntry[];
  nextToken: string | null;
}

export interface ObjectMeta {
  key: string;
  size: number;
  contentType: string | null;
  etag: string | null;
  lastModified: number | null;
  metadata: Record<string, string>;
  cacheControl: string | null;
  contentDisposition: string | null;
}

// ── Operations ────────────────────────────────────────────────────────────────

export async function probe(
  connectionId: string,
  cfg: R2Config,
): Promise<ProbeResult> {
  const client = clientFor(connectionId, cfg);
  const out = await client.send(new ListBucketsCommand({}));
  return {
    ok: true,
    buckets: out.Buckets?.length ?? 0,
    endpoint: endpointFor(cfg.accountId),
  };
}

export async function listBuckets(
  connectionId: string,
  cfg: R2Config,
): Promise<BucketInfo[]> {
  const client = clientFor(connectionId, cfg);
  const out = await client.send(new ListBucketsCommand({}));
  return (out.Buckets ?? []).map((b) => ({
    name: b.Name ?? "",
    createdAt: b.CreationDate ? b.CreationDate.getTime() : null,
  }));
}

export async function createBucket(
  connectionId: string,
  cfg: R2Config,
  name: string,
): Promise<void> {
  validateBucketName(name);
  const client = clientFor(connectionId, cfg);
  await client.send(new CreateBucketCommand({ Bucket: name }));
}

export async function deleteBucket(
  connectionId: string,
  cfg: R2Config,
  name: string,
): Promise<void> {
  const client = clientFor(connectionId, cfg);
  await client.send(new DeleteBucketCommand({ Bucket: name }));
}

export async function listObjects(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
  prefix: string,
  token: string | null,
): Promise<ObjectListing> {
  const client = clientFor(connectionId, cfg);
  const out = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      Delimiter: "/",
      ContinuationToken: token || undefined,
      MaxKeys: 1000,
    }),
  );
  const folders = (out.CommonPrefixes ?? [])
    .map((p) => p.Prefix ?? "")
    .filter(Boolean);
  const objects: ObjectEntry[] = (out.Contents ?? [])
    // S3 returns the prefix "folder marker" itself as a 0-byte object; hide it.
    .filter((o) => (o.Key ?? "") !== prefix)
    .map((o) => {
      const key = o.Key ?? "";
      return {
        key,
        name: key.slice(prefix.length),
        size: o.Size ?? 0,
        lastModified: o.LastModified ? o.LastModified.getTime() : null,
        storageClass: o.StorageClass ?? null,
      };
    });
  return {
    prefix,
    folders,
    objects,
    nextToken: out.IsTruncated ? out.NextContinuationToken ?? null : null,
  };
}

export async function headObject(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
  key: string,
): Promise<ObjectMeta> {
  validateObjectKey(key);
  const client = clientFor(connectionId, cfg);
  const out = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  );
  return {
    key,
    size: out.ContentLength ?? 0,
    contentType: out.ContentType ?? null,
    etag: out.ETag ?? null,
    lastModified: out.LastModified ? out.LastModified.getTime() : null,
    metadata: out.Metadata ?? {},
    cacheControl: out.CacheControl ?? null,
    contentDisposition: out.ContentDisposition ?? null,
  };
}

export async function uploadObject(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
  key: string,
  body: Readable | Buffer,
  contentType?: string,
): Promise<void> {
  validateObjectKey(key);
  const client = clientFor(connectionId, cfg);
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    },
  });
  await upload.done();
}

export async function copyObject(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
  srcKey: string,
  dstKey: string,
): Promise<void> {
  validateObjectKey(srcKey);
  validateObjectKey(dstKey);
  const client = clientFor(connectionId, cfg);
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      // CopySource must be URL-encoded and bucket-prefixed.
      CopySource: `/${bucket}/${srcKey.split("/").map(encodeURIComponent).join("/")}`,
      Key: dstKey,
    }),
  );
}

export async function deleteObjects(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  const client = clientFor(connectionId, cfg);
  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
}

export async function presignGet(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
  key: string,
  expiresIn = 900,
): Promise<string> {
  validateObjectKey(key);
  const client = clientFor(connectionId, cfg);
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
}

export async function getBucketCors(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
): Promise<CORSRule[]> {
  const client = clientFor(connectionId, cfg);
  try {
    const out = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    return out.CORSRules ?? [];
  } catch (e) {
    // R2 returns NoSuchCORSConfiguration when none is set — treat as empty.
    if ((e as { name?: string }).name === "NoSuchCORSConfiguration") return [];
    throw e;
  }
}

export async function putBucketCors(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
  rules: CORSRule[],
): Promise<void> {
  const client = clientFor(connectionId, cfg);
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: rules },
    }),
  );
}

export async function getBucketLifecycle(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
): Promise<LifecycleRule[]> {
  const client = clientFor(connectionId, cfg);
  try {
    const out = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    return out.Rules ?? [];
  } catch (e) {
    if (
      (e as { name?: string }).name === "NoSuchLifecycleConfiguration"
    ) {
      return [];
    }
    throw e;
  }
}

export async function putBucketLifecycle(
  connectionId: string,
  cfg: R2Config,
  bucket: string,
  rules: LifecycleRule[],
): Promise<void> {
  const client = clientFor(connectionId, cfg);
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: rules },
    }),
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `r2.ts`.

- [ ] **Step 4: Re-run unit tests** (helpers unchanged, confirm still green)

Run: `npx vitest run src/lib/connections/r2.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/r2.ts
git commit -m "feat(r2): S3 client cache and bucket/object operations"
```

### Task 1.3: Cascading client teardown

**Files:** Modify: `src/app/api/connections/[id]/route.ts`

- [ ] **Step 1: Import and call `dropR2Client`** — add the import alongside the existing `drop*` imports, then call it inside the `DELETE` handler next to the other teardown calls (`dropMongoClient(id)`, `dropRedisClient(id)`, etc.):

```ts
import { dropR2Client } from "@/lib/connections/r2";
```
```ts
  dropR2Client(id);
```

(If the existing DELETE handler isn't visible in the excerpt, locate it by the existing `dropConnectionSessions(id)` / `dropMongoClient(id)` calls and add `dropR2Client(id)` in the same block.)

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/connections/[id]/route.ts
git commit -m "feat(r2): drop cached S3 client on connection delete"
```

---

## Phase 2 — API routes

> All routes start with `export const runtime = "nodejs";`. Read the connection with `getConnection(id)` and guard `record?.tech === "r2"` (mirroring how other techs resolve the record in API routes); cast `record.config as R2Config`. Wrap every thrown error with `formatError`.

### Task 2.1: Test/probe route

**Files:** Create: `src/app/api/r2/test/route.ts`

- [ ] **Step 1: Write the route** (mirrors `src/app/api/mongo/test/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import { saveConnection, publicView } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { dropR2Client, probe } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface TestRequest {
  name: string;
  config: R2Config;
  save?: boolean;
}

export async function POST(req: NextRequest) {
  let body: TestRequest;
  try {
    body = (await req.json()) as TestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const cfg = body?.config;
  if (!cfg?.accountId?.trim()) {
    return NextResponse.json({ error: "Account ID is required" }, { status: 400 });
  }
  if (!cfg?.accessKeyId?.trim() || !cfg?.secretAccessKey) {
    return NextResponse.json(
      { error: "Access Key ID and Secret Access Key are required" },
      { status: 400 },
    );
  }

  const probeId = `__probe_${Math.random().toString(36).slice(2)}`;
  try {
    const result = await probe(probeId, cfg);
    const record = body.save
      ? saveConnection({
          tech: "r2",
          name: body.name || "Cloudflare R2",
          config: cfg,
          status: "ok",
        })
      : null;
    return NextResponse.json({
      ok: true,
      probe: result,
      connection: record ? publicView(record) : null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: formatError(err) },
      { status: 200 },
    );
  } finally {
    dropR2Client(probeId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/r2/test/route.ts
git commit -m "feat(r2): test/probe API route"
```

### Task 2.2: Bucket list + create + delete routes

**Files:** Create: `src/app/api/r2/[id]/buckets/route.ts`, `src/app/api/r2/[id]/buckets/[bucket]/route.ts`

- [ ] **Step 1: Write `buckets/route.ts`** (GET list, POST create)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { listBuckets, createBucket } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string }>;
}

function cfgFor(id: string): R2Config | null {
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") return null;
  return rec.config as R2Config;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ buckets: await listBuckets(id, cfg) });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: { name?: string };
  try {
    body = (await req.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = body.name?.trim() ?? "";
  try {
    await createBucket(id, cfg, name);
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Write `buckets/[bucket]/route.ts`** (DELETE)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { deleteBucket } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    await deleteBucket(id, rec.config as R2Config, bucket);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/r2/[id]/buckets
git commit -m "feat(r2): bucket list/create/delete API routes"
```

### Task 2.3: Object list + bulk delete route

**Files:** Create: `src/app/api/r2/[id]/buckets/[bucket]/objects/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { listObjects, deleteObjects } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

function cfgFor(id: string): R2Config | null {
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") return null;
  return rec.config as R2Config;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const prefix = req.nextUrl.searchParams.get("prefix") ?? "";
  const token = req.nextUrl.searchParams.get("token");
  try {
    return NextResponse.json(
      await listObjects(id, cfg, bucket, prefix, token),
    );
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: { keys?: string[] };
  try {
    body = (await req.json()) as { keys?: string[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await deleteObjects(id, cfg, bucket, body.keys ?? []);
    return NextResponse.json({ ok: true, deleted: body.keys?.length ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/r2/[id]/buckets/[bucket]/objects/route.ts
git commit -m "feat(r2): object list + bulk delete API route"
```

### Task 2.4: Upload route (streaming multipart)

**Files:** Create: `src/app/api/r2/[id]/buckets/[bucket]/objects/upload/route.ts`

- [ ] **Step 1: Write the route** — accepts `multipart/form-data` with a `file` field and a `key` field; streams the file body into `uploadObject`. The Web `File` is converted to a Node stream via `Readable.fromWeb`.

```ts
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { uploadObject } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const cfg = rec.config as R2Config;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form" }, { status: 400 });
  }
  const file = form.get("file");
  const key = String(form.get("key") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  try {
    // Web ReadableStream → Node Readable for lib-storage streaming.
    const nodeStream = Readable.fromWeb(
      file.stream() as unknown as import("node:stream/web").ReadableStream,
    );
    await uploadObject(
      id,
      cfg,
      bucket,
      key,
      nodeStream,
      file.type || "application/octet-stream",
    );
    return NextResponse.json({ ok: true, key });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/r2/[id]/buckets/[bucket]/objects/upload/route.ts
git commit -m "feat(r2): streaming multipart upload route"
```

### Task 2.5: Download (presigned redirect), meta, presign routes

**Files:** Create: `.../objects/download/route.ts`, `.../objects/meta/route.ts`, `.../objects/presign/route.ts`

- [ ] **Step 1: Write `download/route.ts`** — 302 to a short-lived presigned GET

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { presignGet } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const key = req.nextUrl.searchParams.get("key") ?? "";
  try {
    const url = await presignGet(id, rec.config as R2Config, bucket, key, 300);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Write `meta/route.ts`** — `headObject`

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { headObject } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const key = req.nextUrl.searchParams.get("key") ?? "";
  try {
    return NextResponse.json(
      await headObject(id, rec.config as R2Config, bucket, key),
    );
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 3: Write `presign/route.ts`** — returns a copyable URL (default 1h TTL)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { presignGet } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let body: { key?: string; expiresIn?: number };
  try {
    body = (await req.json()) as { key?: string; expiresIn?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const url = await presignGet(
      id,
      rec.config as R2Config,
      bucket,
      body.key ?? "",
      Math.min(body.expiresIn ?? 3600, 604800),
    );
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/r2/[id]/buckets/[bucket]/objects/download src/app/api/r2/[id]/buckets/[bucket]/objects/meta src/app/api/r2/[id]/buckets/[bucket]/objects/presign
git commit -m "feat(r2): download redirect, meta, and presign routes"
```

### Task 2.6: Copy/rename/move route

**Files:** Create: `src/app/api/r2/[id]/buckets/[bucket]/objects/copy/route.ts`

- [ ] **Step 1: Write the route** — copies `from`→`to`; when `move` is true, deletes the source after copying (rename/move).

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { copyObject, deleteObjects } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const cfg = rec.config as R2Config;
  let body: { from?: string; to?: string; move?: boolean };
  try {
    body = (await req.json()) as { from?: string; to?: string; move?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const from = body.from ?? "";
  const to = body.to ?? "";
  try {
    await copyObject(id, cfg, bucket, from, to);
    if (body.move && from !== to) {
      await deleteObjects(id, cfg, bucket, [from]);
    }
    return NextResponse.json({ ok: true, to });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/r2/[id]/buckets/[bucket]/objects/copy/route.ts
git commit -m "feat(r2): object copy/rename/move route"
```

### Task 2.7: CORS + lifecycle routes

**Files:** Create: `.../cors/route.ts`, `.../lifecycle/route.ts`

- [ ] **Step 1: Write `cors/route.ts`** (GET/PUT)

```ts
import { NextRequest, NextResponse } from "next/server";
import type { CORSRule } from "@aws-sdk/client-s3";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { getBucketCors, putBucketCors } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

function cfgFor(id: string): R2Config | null {
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") return null;
  return rec.config as R2Config;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({ rules: await getBucketCors(id, cfg, bucket) });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: { rules?: CORSRule[] };
  try {
    body = (await req.json()) as { rules?: CORSRule[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await putBucketCors(id, cfg, bucket, body.rules ?? []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 2: Write `lifecycle/route.ts`** (GET/PUT — identical shape, `LifecycleRule[]`)

```ts
import { NextRequest, NextResponse } from "next/server";
import type { LifecycleRule } from "@aws-sdk/client-s3";
import { getConnection } from "@/lib/connections/store";
import type { R2Config } from "@/lib/connections/types";
import { formatError } from "@/lib/errors";
import { getBucketLifecycle, putBucketLifecycle } from "@/lib/connections/r2";

export const runtime = "nodejs";

interface Ctx {
  params: Promise<{ id: string; bucket: string }>;
}

function cfgFor(id: string): R2Config | null {
  const rec = getConnection(id);
  if (!rec || rec.tech !== "r2") return null;
  return rec.config as R2Config;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json({
      rules: await getBucketLifecycle(id, cfg, bucket),
    });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { id, bucket } = await ctx.params;
  const cfg = cfgFor(id);
  if (!cfg) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: { rules?: LifecycleRule[] };
  try {
    body = (await req.json()) as { rules?: LifecycleRule[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await putBucketLifecycle(id, cfg, bucket, body.rules ?? []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: formatError(err) }, { status: 400 });
  }
}
```

- [ ] **Step 3: Typecheck all routes**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/r2/[id]/buckets/[bucket]/cors src/app/api/r2/[id]/buckets/[bucket]/lifecycle
git commit -m "feat(r2): bucket CORS and lifecycle routes"
```

---

## Phase 3 — Connection form

### Task 3.1: R2Form

**Files:** Create: `src/app/r2/r2-form.tsx`

- [ ] **Step 1: Write the form** (adapts `mongo-form.tsx`: `buildConfig` omits the blank secret when editing; edit mode PATCHes `/api/connections/[id]`)

```tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, R2Config } from "@/lib/connections/types";

interface Props {
  onSaved?: () => void;
  initial?: ConnectionRecord;
}

interface Probe {
  buckets: number;
  endpoint: string;
}

export function R2Form({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as R2Config | undefined;

  const [name, setName] = useState(initial?.name ?? "Cloudflare R2");
  const [accountId, setAccountId] = useState(init?.accountId ?? "");
  const [accessKeyId, setAccessKeyId] = useState(init?.accessKeyId ?? "");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucket, setBucket] = useState(init?.bucket ?? "");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      accountId: accountId.trim(),
      accessKeyId: accessKeyId.trim(),
      bucket: bucket.trim(),
    };
    if (secretAccessKey) cfg.secretAccessKey = secretAccessKey;
    else if (!editing) cfg.secretAccessKey = "";
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true);
    setError(null);
    setProbe(null);
    try {
      if (save && editing && initial) {
        const res = await fetch(`/api/connections/${initial.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, config: buildConfig() }),
        });
        const data = await res.json();
        if (res.ok) {
          toast.success("Connection updated");
          onSaved?.();
        } else {
          setError(data.error || "Update failed");
          toast.error("Update failed", { description: data.error });
        }
        return;
      }
      const res = await fetch("/api/r2/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbe(data.probe);
        if (save) {
          toast.success("Connection saved");
          onSaved?.();
        } else {
          toast.success("Connection works", {
            description: `${data.probe.buckets} bucket(s)`,
          });
        }
      } else {
        setError(data.error || "Connection failed");
        toast.error("Connection failed", { description: data.error });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error("Request failed", { description: msg });
    } finally {
      setTesting(false);
    }
  };

  const missingSecret = editing ? false : !secretAccessKey;
  const testDisabled =
    testing || !accountId.trim() || !accessKeyId.trim() || missingSecret;

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">
          {editing ? "Edit connection" : "New connection"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Connect to a Cloudflare R2 bucket with an S3 API token. Find your
          Account ID and create API tokens in the Cloudflare dashboard under
          R2.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-name">Name</Label>
        <Input id="r2-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-account">Account ID</Label>
        <Input
          id="r2-account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="8df1045d97ff80861a1278eb2c88a17e"
        />
        <p className="text-[11px] text-muted-foreground">
          Endpoint:{" "}
          <code className="text-[11px]">
            https://{accountId || "<account-id>"}.r2.cloudflarestorage.com
          </code>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-akid">Access Key ID</Label>
        <Input
          id="r2-akid"
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-secret">Secret Access Key</Label>
        <Input
          id="r2-secret"
          type="password"
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder={
            editing ? "(unchanged — leave blank to keep)" : "secret access key"
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Stored encrypted-at-rest as a secret — never returned over the API.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="r2-bucket">Default bucket (optional)</Label>
        <Input
          id="r2-bucket"
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
          placeholder="my-bucket"
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => test(false)} disabled={testDisabled} variant="outline">
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
          Test
        </Button>
        <Button onClick={() => test(true)} disabled={testing}>
          {editing ? <Save className="size-4" /> : null}
          {editing ? "Save changes" : "Test & save"}
        </Button>
      </div>

      {probe ? (
        <Alert>
          <AlertTitle>Connected</AlertTitle>
          <AlertDescription>
            {probe.buckets} bucket(s) · {probe.endpoint}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not connect</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/r2/r2-form.tsx
git commit -m "feat(r2): connection form"
```

### Task 3.2: Register R2Form in ConnectionSheet + standalone page

**Files:** Modify: `src/components/connection-sheet.tsx`; Create: `src/app/r2/page.tsx`

- [ ] **Step 1: Register the form** — add the import and the `FORMS` entry

```ts
import { R2Form } from "@/app/r2/r2-form";
```
```ts
const FORMS: Record<TechId, React.ComponentType<ConnectionFormProps>> = {
  docker: DockerForm,
  postgres: PostgresForm,
  mysql: MysqlForm,
  kafka: KafkaForm,
  sqlserver: SqlServerForm,
  kubernetes: KubernetesForm,
  redis: RedisForm,
  mongo: MongoForm,
  r2: R2Form,
};
```

- [ ] **Step 2: Create the standalone `/r2` page** — mirror an existing tech's `src/app/<tech>/page.tsx`. Find the pattern with: `cat src/app/mongo/page.tsx`. Replicate it for r2, substituting `tech="r2"`, `getTech("r2")`, and `<R2Form />` (it reuses the same connection-management page component the other techs use). Match imports/structure exactly to that file.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (no missing-key error on `FORMS`).

- [ ] **Step 4: Commit**

```bash
git add src/components/connection-sheet.tsx src/app/r2/page.tsx
git commit -m "feat(r2): register R2 form in sheet and add /r2 page"
```

---

## Phase 4 — Workspace shell, sidebar, overview, tabs

### Task 4.1: Workspace layout

**Files:** Create: `src/app/r2/[connectionId]/layout.tsx`

- [ ] **Step 1: Write the layout** (mirrors `mongo/[connectionId]/layout.tsx`)

```tsx
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { probe } from "@/lib/connections/r2";
import { R2Sidebar } from "./r2-sidebar";
import { R2Tabs } from "./r2-tabs";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function R2WorkspaceLayout({
  params,
  children,
}: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<R2Config>(connectionId, "r2");
  const tech = getTech("r2")!;
  const result = await probe(connectionId, record.config).catch(() => null);
  const subtitle = result
    ? `${result.buckets} bucket(s)`
    : "unreachable";

  return (
    <WorkspaceShell
      tech={tech}
      connectionName={record.name}
      subtitle={subtitle}
      sidebar={
        <R2Sidebar
          connectionId={connectionId}
          defaultBucket={record.config.bucket ?? ""}
        />
      }
    >
      <div className="flex flex-col h-full min-h-0">
        <R2Tabs connectionId={connectionId} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
```

- [ ] **Step 2: Commit** (will not typecheck until sidebar/tabs exist — commit after Task 4.4. Skip commit here.)

### Task 4.2: Sidebar (bucket list)

**Files:** Create: `src/app/r2/[connectionId]/r2-sidebar.tsx`

- [ ] **Step 1: Write the sidebar** — a flat bucket list (no nested tree; folders are browsed inside the bucket page). Adapts the structure of `mongo-sidebar.tsx` but simpler.

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  Database,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface BucketInfo {
  name: string;
  createdAt: number | null;
}

interface Props {
  connectionId: string;
  defaultBucket: string;
}

export function R2Sidebar({ connectionId, defaultBucket }: Props) {
  const pathname = usePathname();
  const [buckets, setBuckets] = useState<BucketInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [working, setWorking] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/r2/${connectionId}/buckets`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = await res.json();
        setBuckets(data.buckets as BucketInfo[]);
      }
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const base = `/r2/${connectionId}`;
  const overviewActive = pathname === base;

  const createBucket = async () => {
    setWorking(true);
    try {
      const res = await fetch(`/api/r2/${connectionId}/buckets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Created ${newName}`);
        setCreateOpen(false);
        setNewName("");
        load();
      } else {
        toast.error("Create failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  const deleteBucket = async (name: string) => {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/r2/${connectionId}/buckets/${encodeURIComponent(name)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (res.ok) {
        toast.success(`Deleted ${name}`);
        setDeleteTarget(null);
        load();
      } else {
        toast.error("Delete failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-1 select-none">
      <Link
        href={base}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-mono transition-colors",
          overviewActive
            ? "bg-foreground/10 text-foreground font-medium"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        <Database className="size-3 shrink-0" />
        Overview
      </Link>

      <div className="flex items-center justify-between px-2 py-1 pt-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <Boxes className="size-3" />
          Buckets
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setCreateOpen(true)}
            title="New bucket"
          >
            <Plus className="size-3" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={load}
            title="Refresh"
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <RefreshCcw className="size-3" />
            )}
          </Button>
        </div>
      </div>

      {buckets === null ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
      ) : buckets.length === 0 ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">(no buckets)</div>
      ) : (
        <ul>
          {buckets.map((b) => {
            const href = `${base}/buckets/${encodeURIComponent(b.name)}`;
            const active = pathname.startsWith(href);
            return (
              <li
                key={b.name}
                className={cn(
                  "group/b flex items-center pr-1 rounded-md transition-colors",
                  active ? "bg-foreground/10" : "hover:bg-foreground/5",
                )}
              >
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1 text-xs font-mono",
                    active ? "text-foreground font-medium" : "text-muted-foreground",
                    b.name === defaultBucket && "italic",
                  )}
                >
                  <Boxes className="size-3 shrink-0" />
                  <span className="truncate">{b.name}</span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    className="opacity-0 group-hover/b:opacity-100 data-[popup-open]:opacity-100 size-5 inline-flex items-center justify-center rounded hover:bg-foreground/10 text-muted-foreground outline-none"
                    title="Bucket actions"
                  >
                    <MoreHorizontal className="size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => setDeleteTarget(b.name)}
                      className="text-destructive focus:text-destructive"
                    >
                      Delete bucket…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={createOpen} onOpenChange={(v) => !working && setCreateOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New bucket</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="my-bucket"
            spellCheck={false}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <Button onClick={createBucket} disabled={working || !newName.trim()}>
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => !v && !working && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete bucket?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                <>
                  Permanently delete bucket{" "}
                  <span className="font-mono">{deleteTarget}</span>. The bucket
                  must be empty or R2 will reject the request.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) deleteBucket(deleteTarget);
              }}
              disabled={working}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Confirm `size="icon-xs"` and the dialog components exist** — `grep -n "icon-xs" src/components/ui/button.tsx` (used by mongo-sidebar, so it exists). If `@/components/ui/dialog` is missing, run `npx shadcn@latest add dialog --yes`.

- [ ] **Step 3: Commit after Task 4.4.**

### Task 4.3: Tab strip

**Files:** Create: `src/app/r2/[connectionId]/r2-tabs.tsx`

- [ ] **Step 1: Read the reference** — `cat src/app/mongo/[connectionId]/mongo-tabs.tsx`. Copy it to `r2-tabs.tsx` and adapt:
  - localStorage key → `baklava:r2-tabs:${connectionId}`.
  - Base path → `/r2/${connectionId}`.
  - Keep the middle-click-close behavior (`onMouseDown` preventDefault on `button === 1` + `onAuxClick`) and the `fetched`-gated stale-tab pruner exactly as in the reference (per AGENTS.md tab-strip conventions).
  - Tabs represent opened buckets: label = bucket name, href = `/r2/${connectionId}/buckets/${bucket}`. Derive the current bucket from `usePathname()` matching `/buckets/<name>` and add it to the tab list on mount.

- [ ] **Step 2: Commit after Task 4.4.**

### Task 4.4: Overview page

**Files:** Create: `src/app/r2/[connectionId]/page.tsx`

- [ ] **Step 1: Write the overview** (server component; uses `WorkspacePage` chrome like other techs — confirm its prop names with `grep -n "WorkspacePage" src/app/mongo/[connectionId]/server-status/page.tsx` or any tech page)

```tsx
import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { endpointFor, listBuckets } from "@/lib/connections/r2";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function R2Overview({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<R2Config>(connectionId, "r2");
  const buckets = await listBuckets(connectionId, record.config).catch(() => []);

  return (
    <WorkspacePage
      title="Overview"
      description="Cloudflare R2 object storage"
    >
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Account ID</dt>
        <dd className="font-mono">{record.config.accountId}</dd>
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd className="font-mono break-all">
          {endpointFor(record.config.accountId)}
        </dd>
        <dt className="text-muted-foreground">Buckets</dt>
        <dd className="font-mono">{buckets.length}</dd>
      </dl>
    </WorkspacePage>
  );
}
```

If `WorkspacePage` prop names differ (e.g. it takes `actions`), match the signature found in the grep. Do not invent props.

- [ ] **Step 2: Typecheck the whole workspace shell**

Run: `npx tsc --noEmit`
Expected: clean (layout, sidebar, tabs, page all resolve).

- [ ] **Step 3: Commit layout + sidebar + tabs + overview together**

```bash
git add src/app/r2/[connectionId]/layout.tsx src/app/r2/[connectionId]/r2-sidebar.tsx src/app/r2/[connectionId]/r2-tabs.tsx src/app/r2/[connectionId]/page.tsx
git commit -m "feat(r2): workspace shell, bucket sidebar, tab strip, overview"
```

---

## Phase 5 — File manager (bucket page)

### Task 5.1: Bucket server page + tab shell

**Files:** Create: `src/app/r2/[connectionId]/buckets/[bucket]/page.tsx`, `.../bucket-client.tsx`

- [ ] **Step 1: Write the server page**

```tsx
import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { BucketClient } from "./bucket-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string; bucket: string }>;
}

export default async function BucketPage({ params }: PageProps) {
  const { connectionId, bucket } = await params;
  requireConnection<R2Config>(connectionId, "r2");
  return <BucketClient connectionId={connectionId} bucket={decodeURIComponent(bucket)} />;
}
```

- [ ] **Step 2: Write `bucket-client.tsx`** — a shadcn `Tabs` shell with Objects + Settings (confirm `@/components/ui/tabs` exists via `ls src/components/ui/tabs.tsx`; detail pages elsewhere use it per AGENTS.md)

```tsx
"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { ObjectBrowser } from "./object-browser";
import { BucketSettings } from "./bucket-settings";

interface Props {
  connectionId: string;
  bucket: string;
}

export function BucketClient({ connectionId, bucket }: Props) {
  return (
    <WorkspacePage title={bucket} description="R2 bucket">
      <Tabs defaultValue="objects" className="flex flex-col h-full min-h-0">
        <TabsList>
          <TabsTrigger value="objects">Objects</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="objects" className="flex-1 min-h-0">
          <ObjectBrowser connectionId={connectionId} bucket={bucket} />
        </TabsContent>
        <TabsContent value="settings">
          <BucketSettings connectionId={connectionId} bucket={bucket} />
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}
```

- [ ] **Step 3: Commit after Task 5.3** (children don't exist yet).

### Task 5.2: Object browser (the file manager)

**Files:** Create: `src/app/r2/[connectionId]/buckets/[bucket]/object-browser.tsx`

- [ ] **Step 1: Write the object browser** — breadcrumb prefix nav, folder + object table, upload (picker), download (presigned redirect), copy-link, rename/move, single + bulk delete, new folder, pagination via `nextToken`.

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  Folder,
  FileText,
  Link2,
  Loader2,
  Pencil,
  RefreshCcw,
  Trash2,
  Upload as UploadIcon,
  FolderPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ObjectEntry {
  key: string;
  name: string;
  size: number;
  lastModified: number | null;
  storageClass: string | null;
}
interface Listing {
  prefix: string;
  folders: string[];
  objects: ObjectEntry[];
  nextToken: string | null;
}

function fmtSize(b: number) {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

interface Props {
  connectionId: string;
  bucket: string;
}

export function ObjectBrowser({ connectionId, bucket }: Props) {
  const [prefix, setPrefix] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<ObjectEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [working, setWorking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const apiBase = `/api/r2/${connectionId}/buckets/${encodeURIComponent(bucket)}`;

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      setSelected(new Set());
      try {
        const res = await fetch(
          `${apiBase}/objects?prefix=${encodeURIComponent(p)}`,
          { cache: "no-store" },
        );
        const data = await res.json();
        if (res.ok) setListing(data as Listing);
        else toast.error("List failed", { description: data.error });
      } finally {
        setLoading(false);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    load(prefix);
  }, [load, prefix]);

  const crumbs = prefix ? prefix.replace(/\/$/, "").split("/") : [];

  const upload = async (files: FileList) => {
    setWorking(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("key", `${prefix}${file.name}`);
        const res = await fetch(`${apiBase}/objects/upload`, {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(`Upload failed: ${file.name}`, { description: data.error });
        }
      }
      toast.success("Upload complete");
      load(prefix);
    } finally {
      setWorking(false);
    }
  };

  const download = (key: string) => {
    window.location.href = `${apiBase}/objects/download?key=${encodeURIComponent(key)}`;
  };

  const copyLink = async (key: string) => {
    const res = await fetch(`${apiBase}/objects/presign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (res.ok) {
      await navigator.clipboard.writeText(data.url);
      toast.success("Presigned link copied (1h)");
    } else {
      toast.error("Presign failed", { description: data.error });
    }
  };

  const removeKeys = async (keys: string[]) => {
    setWorking(true);
    try {
      const res = await fetch(`${apiBase}/objects`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Deleted ${keys.length} object(s)`);
        load(prefix);
      } else {
        toast.error("Delete failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  const doRename = async () => {
    if (!renameTarget) return;
    setWorking(true);
    try {
      const to = `${prefix}${renameValue.trim()}`;
      const res = await fetch(`${apiBase}/objects/copy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: renameTarget.key, to, move: true }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Renamed");
        setRenameTarget(null);
        load(prefix);
      } else {
        toast.error("Rename failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  const createFolder = async () => {
    setWorking(true);
    try {
      // A folder is a zero-byte object whose key ends with "/".
      const form = new FormData();
      form.append("file", new Blob([], { type: "application/x-directory" }));
      form.append("key", `${prefix}${folderName.trim().replace(/\/+$/, "")}/`);
      const res = await fetch(`${apiBase}/objects/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Folder created");
        setFolderOpen(false);
        setFolderName("");
        load(prefix);
      } else {
        toast.error("Create folder failed", { description: data.error });
      }
    } finally {
      setWorking(false);
    }
  };

  const toggleSel = (key: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={working}>
          <UploadIcon className="size-3.5" />
          Upload
        </Button>
        <Button size="sm" variant="outline" onClick={() => setFolderOpen(true)}>
          <FolderPlus className="size-3.5" />
          New folder
        </Button>
        {selected.size > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => removeKeys([...selected])}
            disabled={working}
          >
            <Trash2 className="size-3.5" />
            Delete ({selected.size})
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => load(prefix)}
          disabled={loading}
          className="ml-auto"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCcw className="size-3.5" />
          )}
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground flex-wrap">
        <button
          className="hover:text-foreground"
          onClick={() => setPrefix("")}
        >
          {bucket}
        </button>
        {crumbs.map((c, i) => {
          const p = crumbs.slice(0, i + 1).join("/") + "/";
          return (
            <span key={p} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              <button className="hover:text-foreground" onClick={() => setPrefix(p)}>
                {c}
              </button>
            </span>
          );
        })}
      </div>

      {/* Listing */}
      <div className="flex-1 min-h-0 overflow-auto border rounded-md">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background border-b">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="w-8 px-2 py-1.5"></th>
              <th className="px-2 py-1.5">Name</th>
              <th className="px-2 py-1.5 text-right">Size</th>
              <th className="px-2 py-1.5">Modified</th>
              <th className="w-px px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {listing?.folders.map((f) => {
              const name = f.slice(prefix.length).replace(/\/$/, "");
              return (
                <tr
                  key={f}
                  className="border-b hover:bg-foreground/5 cursor-pointer"
                  onClick={() => setPrefix(f)}
                >
                  <td className="px-2 py-1.5"></td>
                  <td className="px-2 py-1.5 font-mono">
                    <span className="inline-flex items-center gap-1.5">
                      <Folder className="size-3.5 text-muted-foreground" />
                      {name}/
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>
                  <td className="px-2 py-1.5 text-muted-foreground">—</td>
                  <td></td>
                </tr>
              );
            })}
            {listing?.objects.map((o) => (
              <tr
                key={o.key}
                className={cn(
                  "border-b hover:bg-foreground/5",
                  selected.has(o.key) && "bg-foreground/5",
                )}
              >
                <td className="px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={selected.has(o.key)}
                    onChange={() => toggleSel(o.key)}
                  />
                </td>
                <td className="px-2 py-1.5 font-mono">
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="size-3.5 text-muted-foreground" />
                    {o.name}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                  {fmtSize(o.size)}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                  {o.lastModified
                    ? new Date(o.lastModified).toLocaleString()
                    : "—"}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-0.5 justify-end">
                    <Button size="icon-xs" variant="ghost" title="Download" onClick={() => download(o.key)}>
                      <Download className="size-3" />
                    </Button>
                    <Button size="icon-xs" variant="ghost" title="Copy link" onClick={() => copyLink(o.key)}>
                      <Link2 className="size-3" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Rename"
                      onClick={() => {
                        setRenameTarget(o);
                        setRenameValue(o.name);
                      }}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      title="Delete"
                      className="text-destructive"
                      onClick={() => removeKeys([o.key])}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {listing && listing.folders.length === 0 && listing.objects.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
                  (empty)
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {listing?.nextToken ? (
        <p className="text-[11px] text-muted-foreground">
          Showing first 1000 entries — refine via folders to see more.
        </p>
      ) : null}

      {/* New folder dialog */}
      <Dialog open={folderOpen} onOpenChange={(v) => !working && setFolderOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <Input
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="folder-name"
            spellCheck={false}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderOpen(false)} disabled={working}>
              Cancel
            </Button>
            <Button onClick={createFolder} disabled={working || !folderName.trim()}>
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(v) => !working && !v && setRenameTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename object</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            spellCheck={false}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={working}>
              Cancel
            </Button>
            <Button onClick={doRename} disabled={working || !renameValue.trim()}>
              {working ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Confirm button sizes exist** — `grep -n "icon-sm\|icon-xs" src/components/ui/button.tsx`. If `icon-sm` is absent, use `size="sm"` with `variant="ghost"` for the refresh button instead.

- [ ] **Step 3: Commit after Task 5.3.**

### Task 5.3: Bucket settings (CORS, lifecycle, public-access info)

**Files:** Create: `src/app/r2/[connectionId]/buckets/[bucket]/bucket-settings.tsx`

- [ ] **Step 1: Write the settings component** — CORS rules as editable JSON, lifecycle rules as read-only JSON view + raw edit, and a read-only public-access note (per spec option A). Keeping CORS/lifecycle as validated JSON textareas avoids a bespoke rule-builder while remaining fully functional.

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";

interface Props {
  connectionId: string;
  bucket: string;
}

function JsonRuleEditor({
  label,
  endpoint,
  help,
}: {
  label: string;
  endpoint: string;
  help: string;
}) {
  const [text, setText] = useState("[]");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setText(JSON.stringify(data.rules ?? [], null, 2));
      else toast.error(`Load ${label} failed`, { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [endpoint, label]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    let rules: unknown;
    try {
      rules = JSON.parse(text);
    } catch {
      toast.error("Invalid JSON");
      return;
    }
    if (!Array.isArray(rules)) {
      toast.error("Expected a JSON array of rules");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rules }),
      });
      const data = await res.json();
      if (res.ok) toast.success(`${label} saved`);
      else toast.error(`Save ${label} failed`, { description: data.error });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <Button size="sm" onClick={save} disabled={loading || saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          Save
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{help}</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={10}
        className="w-full font-mono text-xs rounded-md border bg-background p-2 resize-y"
        disabled={loading}
      />
    </section>
  );
}

export function BucketSettings({ connectionId, bucket }: Props) {
  const base = `/api/r2/${connectionId}/buckets/${encodeURIComponent(bucket)}`;
  return (
    <div className="space-y-8 max-w-3xl py-2">
      <JsonRuleEditor
        label="CORS rules"
        endpoint={`${base}/cors`}
        help="Array of S3 CORSRule objects (AllowedOrigins, AllowedMethods, AllowedHeaders, …)."
      />
      <JsonRuleEditor
        label="Lifecycle rules"
        endpoint={`${base}/lifecycle`}
        help="Array of S3 LifecycleRule objects (ID, Filter, Expiration, …). R2 supports a subset."
      />
      <Alert>
        <AlertTitle className="flex items-center gap-1.5">
          Public access
        </AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            R2 public access (the r2.dev domain and custom domains) is managed
            through the Cloudflare dashboard, not the S3 API, so it can&apos;t be
            toggled here.
          </p>
          <a
            href="https://dash.cloudflare.com/?to=/:account/r2/default/buckets"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-foreground underline"
          >
            Open in Cloudflare dashboard <ExternalLink className="size-3" />
          </a>
        </AlertDescription>
      </Alert>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit the whole bucket page**

```bash
git add src/app/r2/[connectionId]/buckets
git commit -m "feat(r2): bucket file manager — object browser + settings"
```

---

## Phase 6 — Verification & live smoke

### Task 6.1: Static gates

- [ ] **Step 1: Full typecheck** — `npx tsc --noEmit`. Expected: clean.
- [ ] **Step 2: Lint** — `npm run lint`. Expected: clean (no `react-hooks/exhaustive-deps` errors; the repo disables `set-state-in-effect`).
- [ ] **Step 3: Unit tests** — `npx vitest run src/lib/connections/r2.test.ts src/lib/connections/store.test.ts`. Expected: PASS.
- [ ] **Step 4: Production build** — `npm run build`. Expected: build succeeds; if Turbopack errors on bundling `@aws-sdk/*`, add the three packages to `serverExternalPackages` in `next.config.ts`, commit that change, and rebuild.

### Task 6.2: Live smoke test (against the real bucket)

> Use the verified credentials: account `8df1045d97ff80861a1278eb2c88a17e`, accessKeyId `6d9ca113d74103d74ae17b7480ac204c`, secret (from the user), bucket `ditto-receipts`.

- [ ] **Step 1:** `npm run dev`, open `http://localhost:3000/r2`.
- [ ] **Step 2:** Create a connection via the form → Test (expect "1 bucket(s)") → Test & save.
- [ ] **Step 3:** Open the workspace. Verify Overview shows account/endpoint/bucket count, and the sidebar lists `ditto-receipts`.
- [ ] **Step 4:** Open the bucket. Upload a small file → it appears in the listing. Download it (presigned redirect downloads the file). Copy link (clipboard gets a working URL). Create a folder → navigate into it → upload inside → breadcrumb navigates back. Rename an object. Select + bulk delete.
- [ ] **Step 5:** Settings tab → load CORS (empty `[]`), save `[{"AllowedOrigins":["*"],"AllowedMethods":["GET"]}]`, reload to confirm it persisted, then restore to `[]`.
- [ ] **Step 6:** Confirm the secret never leaves the server: `GET /api/connections/<id>` → `config.secretAccessKey` is masked (`••••`), `accessKeyId` is visible.
- [ ] **Step 7:** Delete the test connection from `/r2`; confirm it disappears and `~/.baklava/connections.json` no longer contains it.

### Task 6.3: Documentation & cleanup

- [ ] **Step 1:** Update `AGENTS.md` "Adding a new technology" prose only if a step proved inaccurate during this build (otherwise leave it).
- [ ] **Step 2:** Verify no stray probe scripts or secrets are committed: `git log --oneline -1 --stat | grep -i probe` returns nothing; `git grep -i "fbc17c39d0cd" -- . ':!docs/'` returns nothing in source.
- [ ] **Step 3:** Remind the user to rotate the R2 API token now that testing is complete.

### Task 6.4: Finish the branch

- [ ] **Step 1:** Invoke the `superpowers:finishing-a-development-branch` skill to choose merge/PR/cleanup.

---

## Self-Review

**Spec coverage:**
- R2-only config (no region/endpoint) → Task 0.2 ✓
- `secretAccessKey` secret → Task 0.3 ✓
- Storage category + catalog + icon → Tasks 0.4, 0.7 ✓
- Summary, FIRST_PAGE, sheet registration → Tasks 0.5, 0.6, 3.2 ✓
- Driver: client cache, probe, buckets, objects, head, upload (multipart), copy, delete, presign, CORS, lifecycle → Tasks 1.1–1.2 ✓
- Validation (bucket name, key traversal) → Task 1.1 ✓ (TDD)
- Cascading `dropR2Client` → Task 1.3 ✓
- All 11 API routes (test, buckets, [bucket], objects, upload, download, meta, presign, copy, cors, lifecycle) → Tasks 2.1–2.7 ✓
- Form (edit-mode blank-secret pattern) → Task 3.1 ✓
- Workspace: layout, sidebar (bucket list + create/delete), tabs, overview → Phase 4 ✓
- File manager: breadcrumb, folders+objects, upload, download (presigned), copy-link, rename/move, bulk delete, new folder, pagination note → Task 5.2 ✓
- Settings: CORS + lifecycle editors + public-access info → Task 5.3 ✓
- Download via presigned redirect (no server memory) → Task 2.5 ✓
- Tests + build + live smoke gates → Phase 6 ✓

**Placeholder scan:** No "TBD"/"implement later". Two steps intentionally say "match the signature found via grep" (standalone `/r2` page, `WorkspacePage`/`WorkspaceShell` props, `mongo-tabs` copy) rather than inventing prop names for components not read during planning — the engineer must read the reference file the step names. These are explicit, file-pointed instructions, not vague placeholders.

**Type consistency:** `R2Config`, `dropR2Client`, `probe`, `listBuckets`, `listObjects`, `ObjectListing`/`ObjectEntry`, `presignGet`, `getBucketCors`/`putBucketCors`, `getBucketLifecycle`/`putBucketLifecycle` names are used identically across driver, routes, and UI. Route JSON shapes (`{ buckets }`, `{ folders, objects, nextToken }`, `{ rules }`, `{ url }`, `{ keys }`, `{ from, to, move }`) match between each route and its UI caller.
