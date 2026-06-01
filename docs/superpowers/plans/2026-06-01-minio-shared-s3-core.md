# MinIO via Shared S3 Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MinIO (S3-compatible object storage) as Baklava's 9th tech by extracting R2's S3 logic into shared modules and making R2 + MinIO thin consumers.

**Architecture:** Phase A extracts R2's operations into `s3.ts` (ops take an `S3Client`), a `blob-registry.ts` (tech → client builder/validator), a `blob-handlers.ts` route-handler factory, and shared `src/components/blob/*` workspace UI — refactoring R2 to consume them with **no behavior change**. Phase B adds MinIO: config type, client builder, form, thin route re-exports, thin workspace pages.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React 19, TypeScript, `@aws-sdk/client-s3` / `s3-request-presigner` / `lib-storage`, base-ui/shadcn, vitest.

**Reference spec:** `docs/superpowers/specs/2026-06-01-minio-shared-s3-core-design.md`
**Reference (current R2 code, the source of the extraction):** `src/lib/connections/r2.ts`, `src/app/api/r2/**`, `src/app/r2/**`.

**Branch:** create `feat/minio-shared-s3` off `main` before Task A1.

---

## Phase A — Extract shared S3 core (behavior-preserving refactor of R2)

### Task A1: Shared S3 core `s3.ts` (helpers + types + cache + ops)

**Files:** Create `src/lib/connections/s3.ts`, `src/lib/connections/s3.test.ts`

- [ ] **Step 1: Write the failing test** (the helper tests, moved from `r2.test.ts`, now importing from `./s3`)

```ts
// src/lib/connections/s3.test.ts
import { describe, it, expect } from "vitest";
import { validateBucketName, validateObjectKey, splitKey, joinPrefix } from "./s3";

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
  });
  it("rejects empty and traversal", () => {
    expect(() => validateObjectKey("")).toThrow();
    expect(() => validateObjectKey("../etc/passwd")).toThrow();
    expect(() => validateObjectKey("a/../../b")).toThrow();
  });
});
describe("splitKey", () => {
  it("splits prefix folders and basename", () => {
    expect(splitKey("a/b/c.txt")).toEqual({ folders: ["a", "b"], name: "c.txt" });
    expect(splitKey("file.txt")).toEqual({ folders: [], name: "file.txt" });
  });
});
describe("joinPrefix", () => {
  it("joins with a single slash", () => {
    expect(joinPrefix("a/b/", "c.txt")).toBe("a/b/c.txt");
    expect(joinPrefix("", "c.txt")).toBe("c.txt");
    expect(joinPrefix("a/b", "c.txt")).toBe("a/b/c.txt");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/connections/s3.test.ts`
Expected: FAIL — `Cannot find module './s3'`.

- [ ] **Step 3: Create `s3.ts`** — helpers + types + generic cache + ops (each op takes an `S3Client`). This is R2's logic with the per-tech client construction removed.

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

// ── Pure helpers ────────────────────────────────────────────────────────────

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

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

export function validateObjectKey(key: string): void {
  if (!key || !key.trim()) throw new Error("Object key is required.");
  if (key.split("/").some((seg) => seg === "..")) {
    throw new Error("Object key must not contain '..' path segments.");
  }
}

export function splitKey(key: string): { folders: string[]; name: string } {
  const parts = key.split("/");
  const name = parts.pop() ?? "";
  return { folders: parts.filter(Boolean), name };
}

export function joinPrefix(prefix: string, name: string): string {
  if (!prefix) return name;
  return `${prefix.replace(/\/+$/, "")}/${name}`;
}

// ── Generic client cache (keyed by `${tech}:${connectionId}`) ──────────────────

interface ClientBundle {
  hash: string;
  client: S3Client;
}
const globalKey = Symbol.for("baklava.s3Clients");

function getCache(): Map<string, ClientBundle> {
  const g = globalThis as unknown as Record<symbol, Map<string, ClientBundle>>;
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey];
}

/** Build-or-reuse a cached client; rebuilds + destroys the stale one on hash change. */
export function getCachedClient(
  cacheKey: string,
  hash: string,
  build: () => S3Client,
): S3Client {
  const cache = getCache();
  const cached = cache.get(cacheKey);
  if (cached && cached.hash === hash) return cached.client;
  if (cached) {
    try { cached.client.destroy(); } catch { /* ignore */ }
  }
  const client = build();
  cache.set(cacheKey, { hash, client });
  return client;
}

export function dropCachedClient(cacheKey: string): void {
  const cache = getCache();
  const cached = cache.get(cacheKey);
  if (!cached) return;
  try { cached.client.destroy(); } catch { /* ignore */ }
  cache.delete(cacheKey);
}

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface BucketInfo { name: string; createdAt: number | null; }
export interface ObjectEntry {
  key: string;
  name: string;
  size: number;
  lastModified: number | null;
  storageClass: string | null;
}
export interface ObjectListing {
  prefix: string;
  folders: string[];
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

// ── Operations (each takes an S3Client) ────────────────────────────────────────

export async function probe(client: S3Client): Promise<{ buckets: number }> {
  const out = await client.send(new ListBucketsCommand({}));
  return { buckets: out.Buckets?.length ?? 0 };
}

export async function listBuckets(client: S3Client): Promise<BucketInfo[]> {
  const out = await client.send(new ListBucketsCommand({}));
  return (out.Buckets ?? []).map((b) => ({
    name: b.Name ?? "",
    createdAt: b.CreationDate ? b.CreationDate.getTime() : null,
  }));
}

export async function createBucket(client: S3Client, name: string): Promise<void> {
  validateBucketName(name);
  await client.send(new CreateBucketCommand({ Bucket: name }));
}

export async function deleteBucket(client: S3Client, name: string): Promise<void> {
  await client.send(new DeleteBucketCommand({ Bucket: name }));
}

export async function listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
  token: string | null,
): Promise<ObjectListing> {
  const out = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      Delimiter: "/",
      ContinuationToken: token || undefined,
      MaxKeys: 1000,
    }),
  );
  const folders = (out.CommonPrefixes ?? []).map((p) => p.Prefix ?? "").filter(Boolean);
  const objects: ObjectEntry[] = (out.Contents ?? [])
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
  client: S3Client,
  bucket: string,
  key: string,
): Promise<ObjectMeta> {
  validateObjectKey(key);
  const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
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
  client: S3Client,
  bucket: string,
  key: string,
  body: Readable | Buffer,
  contentType?: string,
): Promise<void> {
  validateObjectKey(key);
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType },
  });
  await upload.done();
}

export async function copyObject(
  client: S3Client,
  bucket: string,
  srcKey: string,
  dstKey: string,
): Promise<void> {
  validateObjectKey(srcKey);
  validateObjectKey(dstKey);
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `/${bucket}/${srcKey.split("/").map(encodeURIComponent).join("/")}`,
      Key: dstKey,
    }),
  );
}

export async function deleteObjects(
  client: S3Client,
  bucket: string,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return;
  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
}

export async function presignGet(
  client: S3Client,
  bucket: string,
  key: string,
  expiresIn = 900,
): Promise<string> {
  validateObjectKey(key);
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function getBucketCors(client: S3Client, bucket: string): Promise<CORSRule[]> {
  try {
    const out = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    return out.CORSRules ?? [];
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchCORSConfiguration") return [];
    throw e;
  }
}

export async function putBucketCors(
  client: S3Client,
  bucket: string,
  rules: CORSRule[],
): Promise<void> {
  await client.send(
    new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }),
  );
}

export async function getBucketLifecycle(
  client: S3Client,
  bucket: string,
): Promise<LifecycleRule[]> {
  try {
    const out = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
    );
    return out.Rules ?? [];
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchLifecycleConfiguration") return [];
    throw e;
  }
}

export async function putBucketLifecycle(
  client: S3Client,
  bucket: string,
  rules: LifecycleRule[],
): Promise<void> {
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: rules },
    }),
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/connections/s3.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/connections/s3.ts src/lib/connections/s3.test.ts
git commit -m "feat(s3): shared S3 core — helpers, client cache, client-parameterized ops"
```

### Task A2: Shrink `r2.ts` to a client builder; delete `r2.test.ts`

**Files:** Modify `src/lib/connections/r2.ts`; Delete `src/lib/connections/r2.test.ts`

- [ ] **Step 1: Replace the entire contents of `r2.ts`** with the thin client builder (helpers + ops now come from `s3.ts`)

```ts
import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { getCachedClient, dropCachedClient } from "./s3";
import type { R2Config } from "./types";

export function endpointFor(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export function r2ClientFor(connectionId: string, cfg: R2Config): S3Client {
  return getCachedClient(
    `r2:${connectionId}`,
    JSON.stringify([cfg.accountId, cfg.accessKeyId, cfg.secretAccessKey]),
    () =>
      new S3Client({
        region: "auto",
        endpoint: endpointFor(cfg.accountId),
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
        requestHandler: { requestTimeout: 15_000 },
      }),
  );
}

export function dropR2Client(connectionId: string): void {
  dropCachedClient(`r2:${connectionId}`);
}
```

- [ ] **Step 2: Delete the old per-driver test** — `git rm src/lib/connections/r2.test.ts` (its cases now live in `s3.test.ts`).

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit`. Expected: errors ONLY in files still importing the removed R2 ops (`src/app/api/r2/**`, `src/app/r2/[connectionId]/layout.tsx`, `.../page.tsx`) — those are fixed in A4–A6. No error inside `r2.ts`/`s3.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/connections/r2.ts src/lib/connections/r2.test.ts
git commit -m "refactor(r2): reduce to client builder, delegate ops to s3 core"
```

### Task A3: Blob registry `blob-registry.ts`

**Files:** Create `src/lib/connections/blob-registry.ts`

- [ ] **Step 1: Write the registry** (MinIO entry references `minio.ts` which doesn't exist yet — create a temporary stub import is NOT allowed, so this task is ordered AFTER Task B-types? No — to keep Phase A self-contained, register ONLY `r2` here now; add the `minio` entry in Phase B Task B3.)

```ts
import "server-only";
import type { S3Client } from "@aws-sdk/client-s3";
import type { TechId, R2Config } from "./types";
import { r2ClientFor, dropR2Client, endpointFor } from "./r2";

export interface BlobTech {
  tech: TechId;
  clientFor(id: string, cfg: unknown): S3Client;
  dropClient(id: string): void;
  /** Returns an error message, or null when the config is valid. */
  validateConfig(cfg: unknown): string | null;
  /** Human-facing endpoint string for the probe response / overview. */
  endpointOf(cfg: unknown): string;
  defaultName: string;
}

export const BLOB_TECHS: Partial<Record<TechId, BlobTech>> = {
  r2: {
    tech: "r2",
    clientFor: (id, cfg) => r2ClientFor(id, cfg as R2Config),
    dropClient: dropR2Client,
    validateConfig: (cfg) => {
      const c = cfg as R2Config;
      if (!c?.accountId?.trim()) return "Account ID is required";
      if (!c?.accessKeyId?.trim() || !c?.secretAccessKey)
        return "Access Key ID and Secret Access Key are required";
      return null;
    },
    endpointOf: (cfg) => endpointFor((cfg as R2Config).accountId),
    defaultName: "Cloudflare R2",
  },
};

export function blobTech(tech: string): BlobTech | undefined {
  return BLOB_TECHS[tech as TechId];
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` (same pre-existing route errors expected). No error in `blob-registry.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/connections/blob-registry.ts
git commit -m "feat(blob): tech registry mapping R2 to its S3 client builder"
```

### Task A4: Route-handler factory `blob-handlers.ts`

**Files:** Create `src/lib/connections/blob-handlers.ts`

- [ ] **Step 1: Write the factory** — returns every route handler bound to a tech.

```ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import type { CORSRule, LifecycleRule } from "@aws-sdk/client-s3";
import { getConnection, saveConnection, publicView } from "@/lib/connections/store";
import { formatError } from "@/lib/errors";
import type { TechId } from "./types";
import { blobTech } from "./blob-registry";
import * as s3 from "./s3";

type Ctx = { params: Promise<Record<string, string>> };

export function blobHandlers(tech: TechId) {
  const bt = blobTech(tech)!;

  /** Resolve the connection + client, or return a 404 response. */
  function resolve(id: string) {
    const rec = getConnection(id);
    if (!rec || rec.tech !== tech) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
    return { rec, client: bt.clientFor(id, rec.config) };
  }

  return {
    async test(req: NextRequest) {
      let body: { name?: string; config?: unknown; save?: boolean };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      const cfg = body?.config;
      const invalid = bt.validateConfig(cfg);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      const probeId = `__probe_${Math.random().toString(36).slice(2)}`;
      try {
        const client = bt.clientFor(probeId, cfg);
        const { buckets } = await s3.probe(client);
        const record = body.save
          ? saveConnection({ tech, name: body.name || bt.defaultName, config: cfg as Record<string, unknown>, status: "ok" })
          : null;
        return NextResponse.json({
          ok: true,
          probe: { buckets, endpoint: bt.endpointOf(cfg) },
          connection: record ? publicView(record) : null,
        });
      } catch (err) {
        return NextResponse.json({ ok: false, error: formatError(err) }, { status: 200 });
      } finally {
        bt.dropClient(probeId);
      }
    },

    async listBuckets(_req: NextRequest, ctx: Ctx) {
      const { id } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      try { return NextResponse.json({ buckets: await s3.listBuckets(r.client) }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 500 }); }
    },

    async createBucket(req: NextRequest, ctx: Ctx) {
      const { id } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      let body: { name?: string };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { await s3.createBucket(r.client, body.name?.trim() ?? ""); return NextResponse.json({ ok: true, name: body.name?.trim() }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async deleteBucket(_req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      try { await s3.deleteBucket(r.client, bucket); return NextResponse.json({ ok: true }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async listObjects(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      const prefix = req.nextUrl.searchParams.get("prefix") ?? "";
      const token = req.nextUrl.searchParams.get("token");
      try { return NextResponse.json(await s3.listObjects(r.client, bucket, prefix, token)); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 500 }); }
    },

    async bulkDelete(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      let body: { keys?: string[] };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { await s3.deleteObjects(r.client, bucket, body.keys ?? []); return NextResponse.json({ ok: true, deleted: body.keys?.length ?? 0 }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async upload(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      let form: FormData;
      try { form = await req.formData(); } catch { return NextResponse.json({ error: "Expected multipart form" }, { status: 400 }); }
      const file = form.get("file");
      const key = String(form.get("key") ?? "");
      if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
      try {
        const nodeStream = Readable.fromWeb(file.stream() as unknown as import("node:stream/web").ReadableStream);
        await s3.uploadObject(r.client, bucket, key, nodeStream, file.type || "application/octet-stream");
        return NextResponse.json({ ok: true, key });
      } catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async download(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      const key = req.nextUrl.searchParams.get("key") ?? "";
      try { return NextResponse.redirect(await s3.presignGet(r.client, bucket, key, 300), 302); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async meta(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      const key = req.nextUrl.searchParams.get("key") ?? "";
      try { return NextResponse.json(await s3.headObject(r.client, bucket, key)); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async presign(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      let body: { key?: string; expiresIn?: number };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { return NextResponse.json({ url: await s3.presignGet(r.client, bucket, body.key ?? "", Math.min(body.expiresIn ?? 3600, 604800)) }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async copy(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      let body: { from?: string; to?: string; move?: boolean };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      const from = body.from ?? "", to = body.to ?? "";
      try {
        await s3.copyObject(r.client, bucket, from, to);
        if (body.move && from !== to) await s3.deleteObjects(r.client, bucket, [from]);
        return NextResponse.json({ ok: true, to });
      } catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async getCors(_req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      try { return NextResponse.json({ rules: await s3.getBucketCors(r.client, bucket) }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 500 }); }
    },
    async putCors(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      let body: { rules?: CORSRule[] };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { await s3.putBucketCors(r.client, bucket, body.rules ?? []); return NextResponse.json({ ok: true }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },

    async getLifecycle(_req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      try { return NextResponse.json({ rules: await s3.getBucketLifecycle(r.client, bucket) }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 500 }); }
    },
    async putLifecycle(req: NextRequest, ctx: Ctx) {
      const { id, bucket } = await ctx.params;
      const r = resolve(id); if (r.error) return r.error;
      let body: { rules?: LifecycleRule[] };
      try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
      try { await s3.putBucketLifecycle(r.client, bucket, body.rules ?? []); return NextResponse.json({ ok: true }); }
      catch (err) { return NextResponse.json({ error: formatError(err) }, { status: 400 }); }
    },
  };
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` (route errors still expected until A5). No error in `blob-handlers.ts`. If TS flags the `resolve()` early-return narrowing (`r.client` possibly undefined), adjust `resolve` to return a discriminated union (`{ ok: true, rec, client } | { ok: false, res }`) and branch on `r.ok` — report the change.

- [ ] **Step 3: Commit**

```bash
git add src/lib/connections/blob-handlers.ts
git commit -m "feat(blob): route-handler factory for S3-compatible techs"
```

### Task A5: Rewrite R2 route files as thin re-exports

**Files:** Modify all 11 files under `src/app/api/r2/**/route.ts`

- [ ] **Step 1: Replace each R2 route file** with its thin re-export. Exact contents:

`src/app/api/r2/test/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const POST = blobHandlers("r2").test;
```
`src/app/api/r2/[id]/buckets/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
const h = blobHandlers("r2");
export const GET = h.listBuckets;
export const POST = h.createBucket;
```
`src/app/api/r2/[id]/buckets/[bucket]/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const DELETE = blobHandlers("r2").deleteBucket;
```
`src/app/api/r2/[id]/buckets/[bucket]/objects/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
const h = blobHandlers("r2");
export const GET = h.listObjects;
export const DELETE = h.bulkDelete;
```
`.../objects/upload/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const POST = blobHandlers("r2").upload;
```
`.../objects/download/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const GET = blobHandlers("r2").download;
```
`.../objects/meta/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const GET = blobHandlers("r2").meta;
```
`.../objects/presign/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const POST = blobHandlers("r2").presign;
```
`.../objects/copy/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
export const POST = blobHandlers("r2").copy;
```
`.../cors/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
const h = blobHandlers("r2");
export const GET = h.getCors;
export const PUT = h.putCors;
```
`.../lifecycle/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
const h = blobHandlers("r2");
export const GET = h.getLifecycle;
export const PUT = h.putLifecycle;
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`. Expected: only the R2 workspace pages (`layout.tsx`/`page.tsx`) still error (fixed in A6).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/r2
git commit -m "refactor(r2): route files delegate to shared blob handlers"
```

### Task A6: Move R2 workspace UI to shared `src/components/blob/`, parameterized by tech

**Files:** Create `src/components/blob/{object-browser,bucket-sidebar,bucket-tabs,bucket-client,bucket-settings}.tsx`; Modify `src/app/r2/[connectionId]/{layout.tsx,page.tsx}`, `.../buckets/[bucket]/page.tsx`; Delete `src/app/r2/[connectionId]/{r2-sidebar.tsx,r2-tabs.tsx}` and `.../buckets/[bucket]/{bucket-client.tsx,object-browser.tsx,bucket-settings.tsx}`.

> This is a **mechanical move + parameterize**. For each component: `git mv` the R2 file to its shared path, then apply the listed edits. Do NOT change any other logic (this is behavior-preserving). Run `tsc`/`lint` after the whole task.

- [ ] **Step 1: object-browser** — `git mv "src/app/r2/[connectionId]/buckets/[bucket]/object-browser.tsx" src/components/blob/object-browser.tsx`. Edits:
  - `interface Props { connectionId: string; bucket: string }` → add `tech: TechId;` and `import type { TechId } from "@/lib/connections/types";`
  - destructure `{ tech, connectionId, bucket }`
  - change `const apiBase = `/api/r2/${connectionId}/buckets/${encodeURIComponent(bucket)}`;` → `const apiBase = `/api/${tech}/${connectionId}/buckets/${encodeURIComponent(bucket)}`;`
  - no other changes.

- [ ] **Step 2: bucket-sidebar** — `git mv "src/app/r2/[connectionId]/r2-sidebar.tsx" src/components/blob/bucket-sidebar.tsx`. Edits:
  - rename exported component `R2Sidebar` → `BucketSidebar`
  - `Props`: add `tech: TechId;` (+ import `TechId`); keep `connectionId`, `defaultBucket`
  - replace every literal `/api/r2/${connectionId}` with `/api/${tech}/${connectionId}` and every workspace link base `/r2/${connectionId}` with `/${tech}/${connectionId}` (the `const base = …` line and any href).

- [ ] **Step 3: bucket-tabs** — `git mv "src/app/r2/[connectionId]/r2-tabs.tsx" src/components/blob/bucket-tabs.tsx`. Edits:
  - rename `R2Tabs` → `BucketTabs`; `Props` add `tech: TechId;`
  - localStorage key `baklava:r2-tabs:${connectionId}` → `baklava:${tech}-tabs:${connectionId}`
  - base path `/r2/${connectionId}` → `/${tech}/${connectionId}`
  - any `tabFromPath` regex/literal matching `/r2/` or `/buckets/` → use `/${tech}/` (keep the `/buckets/<name>` parsing).

- [ ] **Step 4: bucket-settings** — `git mv "src/app/r2/[connectionId]/buckets/[bucket]/bucket-settings.tsx" src/components/blob/bucket-settings.tsx`. Edits: `Props` add `tech: TechId;`; base `/api/r2/${connectionId}` → `/api/${tech}/${connectionId}`.

- [ ] **Step 5: bucket-client** — `git mv "src/app/r2/[connectionId]/buckets/[bucket]/bucket-client.tsx" src/components/blob/bucket-client.tsx`. Edits:
  - `Props` add `tech: TechId;`
  - update imports to `./object-browser` and `./bucket-settings` (same dir now)
  - pass `tech` to `<ObjectBrowser tech connectionId bucket />` and `<BucketSettings tech connectionId bucket />`.

- [ ] **Step 6: Rewrite R2 thin pages** to use the shared components.

`src/app/r2/[connectionId]/layout.tsx`:
```tsx
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { r2ClientFor } from "@/lib/connections/r2";
import { probe } from "@/lib/connections/s3";
import { BucketSidebar } from "@/components/blob/bucket-sidebar";
import { BucketTabs } from "@/components/blob/bucket-tabs";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function R2WorkspaceLayout({ params, children }: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<R2Config>(connectionId, "r2");
  const tech = getTech("r2")!;
  const result = await probe(r2ClientFor(connectionId, record.config)).catch(() => null);
  const subtitle = result ? `${result.buckets} bucket(s)` : "unreachable";
  return (
    <WorkspaceShell tech={tech} connectionName={record.name} subtitle={subtitle}
      sidebar={<BucketSidebar tech="r2" connectionId={connectionId} defaultBucket={record.config.bucket ?? ""} />}>
      <div className="flex flex-col h-full min-h-0">
        <BucketTabs tech="r2" connectionId={connectionId} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
```

`src/app/r2/[connectionId]/page.tsx` (overview — keep R2-specific account display):
```tsx
import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { endpointFor, r2ClientFor } from "@/lib/connections/r2";
import { listBuckets } from "@/lib/connections/s3";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string }>; }

export default async function R2Overview({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<R2Config>(connectionId, "r2");
  const buckets = await listBuckets(r2ClientFor(connectionId, record.config)).catch(() => []);
  return (
    <WorkspacePage title="Overview" description="Cloudflare R2 object storage">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Account ID</dt>
        <dd className="font-mono">{record.config.accountId}</dd>
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd className="font-mono break-all">{endpointFor(record.config.accountId)}</dd>
        <dt className="text-muted-foreground">Buckets</dt>
        <dd className="font-mono">{buckets.length}</dd>
      </dl>
    </WorkspacePage>
  );
}
```

`src/app/r2/[connectionId]/buckets/[bucket]/page.tsx`:
```tsx
import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { BucketClient } from "@/components/blob/bucket-client";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string; bucket: string }>; }

export default async function BucketPage({ params }: PageProps) {
  const { connectionId, bucket } = await params;
  requireConnection<R2Config>(connectionId, "r2");
  return <BucketClient tech="r2" connectionId={connectionId} bucket={decodeURIComponent(bucket)} />;
}
```

- [ ] **Step 7: Delete the now-moved R2 component files** (the `git mv` in steps 1–5 already moved them; ensure no stragglers): confirm `src/app/r2/[connectionId]/` contains only `layout.tsx`, `page.tsx`, and `buckets/[bucket]/page.tsx`.

- [ ] **Step 8: Typecheck + lint** — `npx tsc --noEmit && npm run lint`. Both clean.

- [ ] **Step 9: Commit**

```bash
git add src/components/blob src/app/r2
git commit -m "refactor(r2): move workspace UI to shared src/components/blob, parameterized by tech"
```

### Task A7: R2 regression verification (behavior-preserving proof)

- [ ] **Step 1: Static gates** — `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`. All clean.
- [ ] **Step 2: Live R2 browser smoke** — `npm run dev`; using the existing "Cloudflare R2" connection, open a bucket, upload a file via the picker, confirm it lists + downloads, then delete it. Confirms the extraction didn't regress R2. (Use the verified R2 creds from the R2 spec; rotate later.)
- [ ] **Step 3: No commit** (verification only). If a regression is found, fix it in the relevant A-task file and re-run.

---

## Phase B — Add MinIO

### Task B1: MinioConfig type + secret key

**Files:** Modify `src/lib/connections/types.ts`, `src/lib/connections/store.ts`

- [ ] **Step 1: Add `"minio"` to `TechId`** (append after `"r2"`):
```ts
  | "r2"
  | "minio";
```
- [ ] **Step 2: Append `MinioConfig`:**
```ts
export interface MinioConfig {
  /** "host:port" or a full "http(s)://host:port" URL. */
  endpoint: string;
  /** Used only when `endpoint` has no scheme. */
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  /** S3 region; default "us-east-1". */
  region: string;
  bucket?: string;
}
```
- [ ] **Step 3: Add `"secretKey"` to `SECRET_KEYS`** in `store.ts`.
- [ ] **Step 4: Typecheck** — errors expected only in `summaries.ts`/`tech-catalog.ts`/`connection-tabs.tsx`/`connection-sheet.tsx` (missing `minio` key) until B4. Commit:
```bash
git add src/lib/connections/types.ts src/lib/connections/store.ts
git commit -m "feat(minio): add MinioConfig type, minio TechId, secretKey redaction"
```

### Task B2: MinIO client builder + endpoint resolver (TDD)

**Files:** Create `src/lib/connections/minio.ts`, `src/lib/connections/minio.test.ts`

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, it, expect } from "vitest";
import { resolveEndpoint } from "./minio";

describe("resolveEndpoint", () => {
  it("prefixes http when no scheme and SSL off", () => {
    expect(resolveEndpoint({ endpoint: "localhost:9000", useSSL: false } as never)).toBe("http://localhost:9000");
  });
  it("prefixes https when no scheme and SSL on", () => {
    expect(resolveEndpoint({ endpoint: "minio.example.com", useSSL: true } as never)).toBe("https://minio.example.com");
  });
  it("uses an explicit http(s) URL verbatim, ignoring the toggle", () => {
    expect(resolveEndpoint({ endpoint: "https://m.example.com:9000", useSSL: false } as never)).toBe("https://m.example.com:9000");
    expect(resolveEndpoint({ endpoint: "http://localhost:9000", useSSL: true } as never)).toBe("http://localhost:9000");
  });
  it("trims whitespace", () => {
    expect(resolveEndpoint({ endpoint: "  localhost:9000  ", useSSL: false } as never)).toBe("http://localhost:9000");
  });
});
```
- [ ] **Step 2: Run → FAIL** (`Cannot find module './minio'`). `npx vitest run src/lib/connections/minio.test.ts`.
- [ ] **Step 3: Implement `minio.ts`:**
```ts
import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { getCachedClient, dropCachedClient } from "./s3";
import type { MinioConfig } from "./types";

export function resolveEndpoint(cfg: MinioConfig): string {
  const e = cfg.endpoint.trim();
  if (/^https?:\/\//i.test(e)) return e;
  return `${cfg.useSSL ? "https" : "http"}://${e}`;
}

export function minioClientFor(connectionId: string, cfg: MinioConfig): S3Client {
  return getCachedClient(
    `minio:${connectionId}`,
    JSON.stringify([cfg.endpoint, cfg.useSSL, cfg.accessKey, cfg.secretKey, cfg.region]),
    () =>
      new S3Client({
        region: cfg.region || "us-east-1",
        endpoint: resolveEndpoint(cfg),
        forcePathStyle: true,
        credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
        requestHandler: { requestTimeout: 15_000 },
      }),
  );
}

export function dropMinioClient(connectionId: string): void {
  dropCachedClient(`minio:${connectionId}`);
}
```
- [ ] **Step 4: Run → PASS.** **Step 5: Commit:**
```bash
git add src/lib/connections/minio.ts src/lib/connections/minio.test.ts
git commit -m "feat(minio): S3 client builder + endpoint resolver with tests"
```

### Task B3: Register MinIO in the blob registry

**Files:** Modify `src/lib/connections/blob-registry.ts`

- [ ] **Step 1: Add imports + the `minio` entry:**
```ts
import type { TechId, R2Config, MinioConfig } from "./types";
import { minioClientFor, dropMinioClient, resolveEndpoint } from "./minio";
```
```ts
  minio: {
    tech: "minio",
    clientFor: (id, cfg) => minioClientFor(id, cfg as MinioConfig),
    dropClient: dropMinioClient,
    validateConfig: (cfg) => {
      const c = cfg as MinioConfig;
      if (!c?.endpoint?.trim()) return "Endpoint is required";
      if (!c?.accessKey?.trim() || !c?.secretKey)
        return "Access Key and Secret Key are required";
      return null;
    },
    endpointOf: (cfg) => resolveEndpoint(cfg as MinioConfig),
    defaultName: "MinIO",
  },
```
- [ ] **Step 2: Typecheck** — no error in `blob-registry.ts`. **Step 3: Commit:**
```bash
git add src/lib/connections/blob-registry.ts
git commit -m "feat(minio): register MinIO in the blob registry"
```

### Task B4: Catalog, summary, tabs, sheet, cascading delete, icon

**Files:** Modify `tech-catalog.ts`, `summaries.ts`, `connection-tabs.tsx`, `connection-sheet.tsx`, `api/connections/[id]/route.ts`; Create `public/icons/minio.svg`

- [ ] **Step 1: tech-catalog.ts** — append entry:
```ts
  {
    id: "minio",
    name: "MinIO",
    tagline: "S3-compatible object storage",
    description: "Self-hosted S3 object browser: buckets, prefix navigation, upload/download, presigned links, CORS and lifecycle.",
    category: "Storage",
    color: "from-red-400 to-rose-600",
    status: "available",
  },
```
- [ ] **Step 2: summaries.ts** — import `MinioConfig`; add:
```ts
  minio: (r) => {
    const cfg = r.config as MinioConfig;
    const bucket = cfg.bucket ? ` · ${cfg.bucket}` : "";
    return `${cfg.accessKey}@${cfg.endpoint}${bucket}`;
  },
```
- [ ] **Step 3: connection-tabs.tsx** — add `minio: ""` to `FIRST_PAGE`; add `minio` to the `activeIdFromPath` regex alternation (alongside `r2`).
- [ ] **Step 4: connection-sheet.tsx** — `import { MinioForm } from "@/app/minio/minio-form";` and add `minio: MinioForm,` to `FORMS`.
- [ ] **Step 5: api/connections/[id]/route.ts** — `import { dropMinioClient } from "@/lib/connections/minio";` and call `dropMinioClient(id);` in the DELETE handler beside `dropR2Client(id)`.
- [ ] **Step 6: public/icons/minio.svg:**
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="MinIO">
  <path d="M12 2 4 6.5v11L12 22l8-4.5v-11L12 2Zm0 2.3 5.6 3.1L12 10.5 6.4 7.4 12 4.3Zm-6 4.8 5 2.8v6.3l-5-2.8V9.1Zm12 0v6.3l-5 2.8v-6.3l5-2.8Z"/>
</svg>
```
- [ ] **Step 7: Typecheck + lint** — `npx tsc --noEmit && npm run lint`. The `FORMS` import of `MinioForm` will error until B5 — so do B5 before this gate, or accept the temporary error and run the gate at the end of B5. **Commit after B5.**

### Task B5: MinIO connection form

**Files:** Create `src/app/minio/minio-form.tsx`

- [ ] **Step 1: Write the form** (adapts `r2-form.tsx`; adds the `Switch` for SSL):
```tsx
"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Loader2, PlugZap, Save } from "lucide-react";
import type { ConnectionRecord, MinioConfig } from "@/lib/connections/types";

interface Props { onSaved?: () => void; initial?: ConnectionRecord; }
interface Probe { buckets: number; endpoint: string; }

export function MinioForm({ onSaved, initial }: Props) {
  const editing = Boolean(initial);
  const init = initial?.config as MinioConfig | undefined;

  const [name, setName] = useState(initial?.name ?? "MinIO");
  const [endpoint, setEndpoint] = useState(init?.endpoint ?? "");
  const [useSSL, setUseSSL] = useState(init?.useSSL ?? false);
  const [accessKey, setAccessKey] = useState(init?.accessKey ?? "");
  const [secretKey, setSecretKey] = useState("");
  const [region, setRegion] = useState(init?.region ?? "us-east-1");
  const [bucket, setBucket] = useState(init?.bucket ?? "");

  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe | null>(null);

  const buildConfig = (): Record<string, unknown> => {
    const cfg: Record<string, unknown> = {
      endpoint: endpoint.trim(), useSSL,
      accessKey: accessKey.trim(), region: region.trim() || "us-east-1",
      bucket: bucket.trim(),
    };
    if (secretKey) cfg.secretKey = secretKey;
    else if (!editing) cfg.secretKey = "";
    return cfg;
  };

  const test = async (save: boolean) => {
    setTesting(true); setError(null); setProbe(null);
    try {
      if (save && editing && initial) {
        const res = await fetch(`/api/connections/${initial.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, config: buildConfig() }),
        });
        const data = await res.json();
        if (res.ok) { toast.success("Connection updated"); onSaved?.(); }
        else { setError(data.error || "Update failed"); toast.error("Update failed", { description: data.error }); }
        return;
      }
      const res = await fetch("/api/minio/test", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config: buildConfig(), save }),
      });
      const data = await res.json();
      if (data.ok) {
        setProbe(data.probe);
        if (save) { toast.success("Connection saved"); onSaved?.(); }
        else toast.success("Connection works", { description: `${data.probe.buckets} bucket(s)` });
      } else { setError(data.error || "Connection failed"); toast.error("Connection failed", { description: data.error }); }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg); toast.error("Request failed", { description: msg });
    } finally { setTesting(false); }
  };

  const missingSecret = editing ? false : !secretKey;
  const testDisabled = testing || !endpoint.trim() || !accessKey.trim() || missingSecret;

  return (
    <Card className="p-6 space-y-5">
      <div className="space-y-1">
        <h2 className="font-semibold">{editing ? "Edit connection" : "New connection"}</h2>
        <p className="text-sm text-muted-foreground">
          Connect to a MinIO (or any S3-compatible) server. Enter the endpoint as
          <code className="text-[11px]"> host:port</code> or a full URL.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-name">Name</Label>
        <Input id="minio-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-endpoint">Endpoint</Label>
        <Input id="minio-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}
          spellCheck={false} autoComplete="off" placeholder="localhost:9000" />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="minio-ssl">Use SSL</Label>
          <p className="text-[11px] text-muted-foreground">Applied when the endpoint has no http(s):// scheme.</p>
        </div>
        <Switch id="minio-ssl" checked={useSSL} onCheckedChange={setUseSSL} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-access">Access Key</Label>
        <Input id="minio-access" value={accessKey} onChange={(e) => setAccessKey(e.target.value)}
          spellCheck={false} autoComplete="off" placeholder="minioadmin" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-secret">Secret Key</Label>
        <Input id="minio-secret" type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)}
          spellCheck={false} autoComplete="off"
          placeholder={editing ? "(unchanged — leave blank to keep)" : "secret key"} />
        <p className="text-[11px] text-muted-foreground">Stored encrypted-at-rest as a secret — never returned over the API.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-region">Region</Label>
        <Input id="minio-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
      </div>

      <div className="space-y-2">
        <Label htmlFor="minio-bucket">Default bucket (optional)</Label>
        <Input id="minio-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="my-bucket" />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button onClick={() => test(false)} disabled={testDisabled} variant="outline">
          {testing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
          Test
        </Button>
        <Button onClick={() => test(true)} disabled={testing}>
          {editing ? <Save className="size-4" /> : null}
          {editing ? "Save changes" : "Test & save"}
        </Button>
      </div>

      {probe ? (
        <Alert><AlertTitle>Connected</AlertTitle>
          <AlertDescription>{probe.buckets} bucket(s) · {probe.endpoint}</AlertDescription></Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive"><AlertTitle>Could not connect</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription></Alert>
      ) : null}
    </Card>
  );
}
```
- [ ] **Step 2: Verify `Switch`'s prop is `onCheckedChange`** — `grep -n "onCheckedChange\|onChange" src/components/ui/switch.tsx`. If the wrapper uses a different prop (e.g. base-ui `onCheckedChange` vs a custom name), match it. Adjust if needed.
- [ ] **Step 3: Typecheck + lint** (now covers B4 too) — `npx tsc --noEmit && npm run lint`. Clean.
- [ ] **Step 4: Commit B4 + B5 together:**
```bash
git add src/app/minio/minio-form.tsx src/lib/tech-catalog.ts src/lib/connections/summaries.ts src/components/connection-tabs.tsx src/components/connection-sheet.tsx "src/app/api/connections/[id]/route.ts" public/icons/minio.svg
git commit -m "feat(minio): form, catalog, summary, tab routing, sheet registration, teardown, icon"
```

### Task B6: MinIO API routes + workspace pages (thin)

**Files:** Create the 11 `src/app/api/minio/**/route.ts` files + `src/app/minio/[connectionId]/{layout,page}.tsx` + `.../buckets/[bucket]/page.tsx`

- [ ] **Step 1: Create the 11 route files** — identical to the R2 thin re-exports in Task A5 but with `blobHandlers("minio")`. Paths mirror R2 under `src/app/api/minio/`. Example `src/app/api/minio/[id]/buckets/[bucket]/objects/route.ts`:
```ts
import { blobHandlers } from "@/lib/connections/blob-handlers";
export const runtime = "nodejs";
const h = blobHandlers("minio");
export const GET = h.listObjects;
export const DELETE = h.bulkDelete;
```
Create all 11 (test; buckets GET+POST; [bucket] DELETE; objects GET+DELETE; upload POST; download GET; meta GET; presign POST; copy POST; cors GET+PUT; lifecycle GET+PUT) — same handler names as A5, swapping `"r2"`→`"minio"`.

- [ ] **Step 2: layout.tsx** — `src/app/minio/[connectionId]/layout.tsx`:
```tsx
import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { MinioConfig } from "@/lib/connections/types";
import { minioClientFor } from "@/lib/connections/minio";
import { probe } from "@/lib/connections/s3";
import { BucketSidebar } from "@/components/blob/bucket-sidebar";
import { BucketTabs } from "@/components/blob/bucket-tabs";

export const dynamic = "force-dynamic";

interface LayoutProps { params: Promise<{ connectionId: string }>; children: React.ReactNode; }

export default async function MinioWorkspaceLayout({ params, children }: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<MinioConfig>(connectionId, "minio");
  const tech = getTech("minio")!;
  const result = await probe(minioClientFor(connectionId, record.config)).catch(() => null);
  const subtitle = result ? `${result.buckets} bucket(s)` : "unreachable";
  return (
    <WorkspaceShell tech={tech} connectionName={record.name} subtitle={subtitle}
      sidebar={<BucketSidebar tech="minio" connectionId={connectionId} defaultBucket={record.config.bucket ?? ""} />}>
      <div className="flex flex-col h-full min-h-0">
        <BucketTabs tech="minio" connectionId={connectionId} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
```
- [ ] **Step 3: page.tsx** (overview — MinIO shows endpoint) `src/app/minio/[connectionId]/page.tsx`:
```tsx
import { requireConnection } from "@/lib/connections/server";
import type { MinioConfig } from "@/lib/connections/types";
import { minioClientFor, resolveEndpoint } from "@/lib/connections/minio";
import { listBuckets } from "@/lib/connections/s3";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string }>; }

export default async function MinioOverview({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<MinioConfig>(connectionId, "minio");
  const buckets = await listBuckets(minioClientFor(connectionId, record.config)).catch(() => []);
  return (
    <WorkspacePage title="Overview" description="MinIO object storage">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd className="font-mono break-all">{resolveEndpoint(record.config)}</dd>
        <dt className="text-muted-foreground">Region</dt>
        <dd className="font-mono">{record.config.region || "us-east-1"}</dd>
        <dt className="text-muted-foreground">Buckets</dt>
        <dd className="font-mono">{buckets.length}</dd>
      </dl>
    </WorkspacePage>
  );
}
```
- [ ] **Step 4: bucket page** `src/app/minio/[connectionId]/buckets/[bucket]/page.tsx`:
```tsx
import { requireConnection } from "@/lib/connections/server";
import type { MinioConfig } from "@/lib/connections/types";
import { BucketClient } from "@/components/blob/bucket-client";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string; bucket: string }>; }

export default async function BucketPage({ params }: PageProps) {
  const { connectionId, bucket } = await params;
  requireConnection<MinioConfig>(connectionId, "minio");
  return <BucketClient tech="minio" connectionId={connectionId} bucket={decodeURIComponent(bucket)} />;
}
```
- [ ] **Step 5: Typecheck + lint** — `npx tsc --noEmit && npm run lint`. Clean.
- [ ] **Step 6: Commit:**
```bash
git add src/app/api/minio src/app/minio
git commit -m "feat(minio): API routes (thin) + workspace pages reusing shared blob UI"
```

### Task B7: Verification + MinIO live smoke

- [ ] **Step 1: Static gates** — `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`. All clean.
- [ ] **Step 2: Start MinIO** —
```bash
docker run -d --name baklava-minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```
- [ ] **Step 3: Live smoke** — `npm run dev`; create a MinIO connection (endpoint `localhost:9000`, SSL off, `minioadmin`/`minioadmin`, region `us-east-1`) → Test (expect "0 bucket(s)") → save. Open workspace → create a bucket → upload a file via the picker → confirm it lists + downloads + presign works → CORS round-trip in Settings → delete object/bucket.
- [ ] **Step 4: Teardown** — `docker rm -f baklava-minio`; remove the MinIO test connection from the home Sheet.
- [ ] **Step 5: No commit** (verification only).

### Task B8: Finish the branch

- [ ] **Step 1:** Invoke `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage:**
- Shared `s3.ts` (helpers/types/cache/ops) → A1 ✓
- R2 reduced to client builder → A2 ✓
- `blob-registry.ts` (R2 then MinIO) → A3, B3 ✓
- `blob-handlers.ts` factory; R2 + MinIO routes delegate → A4, A5, B6 ✓
- Shared `src/components/blob/*` parameterized by tech; R2 pages thin → A6 ✓
- R2 regression re-verification → A7 ✓
- `MinioConfig` + `minio` TechId + `secretKey` secret → B1 ✓
- `minio.ts` client builder + `resolveEndpoint` (both input styles) → B2 ✓ (TDD)
- Catalog/summary/FIRST_PAGE/sheet/cascading-delete/icon → B4 ✓
- `minio-form` with Switch → B5 ✓
- MinIO routes + workspace pages → B6 ✓
- MinIO live container smoke → B7 ✓
- forcePathStyle:true, region default us-east-1 → B2 ✓

**Placeholder scan:** No "TBD"/"implement later". The UI-move task (A6) gives explicit per-file edits rather than reproducing ~1,100 unchanged lines — appropriate for a behavior-preserving `git mv` + parameterize; each edit is concrete (exact string substitutions and prop additions).

**Type consistency:** `getCachedClient`/`dropCachedClient`, `r2ClientFor`/`minioClientFor`, `dropR2Client`/`dropMinioClient`, `blobTech`/`blobHandlers`, `BlobTech` fields (`clientFor`/`dropClient`/`validateConfig`/`endpointOf`/`defaultName`), and `probe` returning `{ buckets }` are used identically across `s3.ts`, the registry, the handlers, and the pages. Shared UI props add `tech: TechId` consistently. Route JSON shapes (`{buckets}`, `{folders,objects,nextToken}`, `{rules}`, `{url}`, `{keys}`, `{from,to,move}`, probe `{buckets,endpoint}`) match the R2 contract the UI already consumes.
