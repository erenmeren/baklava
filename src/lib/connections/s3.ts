import "server-only";
import type {
  S3Client,
  S3ClientConfig,
  CORSRule,
  LifecycleRule,
  BucketLocationConstraint,
} from "@aws-sdk/client-s3";
import { DriverNotInstalledError } from "@/techs/contract";

let _s3: typeof import("@aws-sdk/client-s3") | null = null;
async function getS3Sdk() {
  try { return (_s3 ??= await import("@aws-sdk/client-s3")); }
  catch { throw new DriverNotInstalledError("s3", "@aws-sdk/client-s3"); }
}

let _up: typeof import("@aws-sdk/lib-storage") | null = null;
async function getLibStorage() {
  try { return (_up ??= await import("@aws-sdk/lib-storage")); }
  catch { throw new DriverNotInstalledError("s3", "@aws-sdk/lib-storage"); }
}

let _pre: typeof import("@aws-sdk/s3-request-presigner") | null = null;
async function getPresigner() {
  try { return (_pre ??= await import("@aws-sdk/s3-request-presigner")); }
  catch { throw new DriverNotInstalledError("s3", "@aws-sdk/s3-request-presigner"); }
}

import type { Readable } from "node:stream";
import { cache } from "react";

/** Build an S3Client from config, lazy-loading the SDK on first call. */
export async function createS3Client(config: S3ClientConfig): Promise<S3Client> {
  const { S3Client: S3ClientClass } = await getS3Sdk();
  return new S3ClientClass(config);
}

// ── Pure helpers ────────────────────────────────────────────────────────────

const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Validate a bucket name. AWS S3 and Cloudflare R2 enforce strict DNS-style
 * names (the default). MinIO is more permissive (uppercase + underscores), so
 * pass `{ lax: true }` for it to avoid rejecting names its server accepts.
 */
export function validateBucketName(
  name: string,
  { lax = false }: { lax?: boolean } = {},
): void {
  if (name.length < 3 || name.length > 63) {
    throw new Error("Bucket name must be 3–63 characters.");
  }
  if (lax) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$/.test(name)) {
      throw new Error(
        "Bucket name may contain only letters, digits, hyphens, underscores and dots, and must start and end alphanumeric.",
      );
    }
  } else if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(name)) {
    throw new Error(
      "Bucket name may contain only lowercase letters, digits, hyphens and dots, and must start and end alphanumeric.",
    );
  }
  if (name.includes("..")) {
    throw new Error("Bucket name must not contain consecutive dots.");
  }
  if (!lax && IP_RE.test(name)) {
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
export async function getCachedClient(
  cacheKey: string,
  hash: string,
  build: () => Promise<S3Client>,
): Promise<S3Client> {
  const cache = getCache();
  const cached = cache.get(cacheKey);
  if (cached && cached.hash === hash) return cached.client;
  if (cached) {
    try { cached.client.destroy(); } catch { /* ignore */ }
  }
  const client = await build();
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
  const { ListBucketsCommand } = await getS3Sdk();
  const out = await client.send(new ListBucketsCommand({}));
  return { buckets: out.Buckets?.length ?? 0 };
}

/**
 * Request-deduplicated `probe`. The blob workspace layout and its overview page
 * both need the bucket count; since they render in the same RSC pass and share
 * the same cached `S3Client` instance, React's `cache` collapses the two
 * ListBuckets calls into one.
 */
export const probeCached = cache(probe);

export async function listBuckets(client: S3Client): Promise<BucketInfo[]> {
  const { ListBucketsCommand } = await getS3Sdk();
  const out = await client.send(new ListBucketsCommand({}));
  return (out.Buckets ?? []).map((b) => ({
    name: b.Name ?? "",
    createdAt: b.CreationDate ? b.CreationDate.getTime() : null,
  }));
}

export async function createBucket(
  client: S3Client,
  name: string,
  { lax = false }: { lax?: boolean } = {},
): Promise<void> {
  validateBucketName(name, { lax });
  // AWS S3 requires CreateBucketConfiguration.LocationConstraint for every
  // region except us-east-1. R2 ("auto") and MinIO (us-east-1 default) must
  // NOT receive a constraint, so only set it for a real, non-default region.
  const { CreateBucketCommand } = await getS3Sdk();
  const region = await client.config.region();
  const constraint =
    region && region !== "us-east-1" && region !== "auto" ? region : undefined;
  await client.send(
    new CreateBucketCommand({
      Bucket: name,
      ...(constraint
        ? {
            CreateBucketConfiguration: {
              LocationConstraint: constraint as BucketLocationConstraint,
            },
          }
        : {}),
    }),
  );
}

export async function deleteBucket(client: S3Client, name: string): Promise<void> {
  const { DeleteBucketCommand } = await getS3Sdk();
  await client.send(new DeleteBucketCommand({ Bucket: name }));
}

export async function listObjects(
  client: S3Client,
  bucket: string,
  prefix: string,
  token: string | null,
): Promise<ObjectListing> {
  const { ListObjectsV2Command } = await getS3Sdk();
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
  const { HeadObjectCommand } = await getS3Sdk();
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
  const { Upload } = await getLibStorage();
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
  const { CopyObjectCommand } = await getS3Sdk();
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
  const { DeleteObjectsCommand } = await getS3Sdk();
  const out = await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
  // DeleteObjects returns HTTP 200 even when individual keys fail (e.g. access
  // denied). Surface those so callers don't report a false success — and so a
  // rename/move (copy + delete-source) doesn't silently leave a duplicate.
  const errors = out.Errors ?? [];
  if (errors.length > 0) {
    const e = errors[0];
    throw new Error(
      `Failed to delete ${errors.length} object(s): ${e.Key ?? "?"} — ${e.Message ?? e.Code ?? "unknown error"}`,
    );
  }
}

export async function presignGet(
  client: S3Client,
  bucket: string,
  key: string,
  expiresIn = 900,
): Promise<string> {
  validateObjectKey(key);
  const { getSignedUrl } = await getPresigner();
  const { GetObjectCommand } = await getS3Sdk();
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

export async function getBucketCors(client: S3Client, bucket: string): Promise<CORSRule[]> {
  try {
    const { GetBucketCorsCommand } = await getS3Sdk();
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
  const { PutBucketCorsCommand } = await getS3Sdk();
  await client.send(
    new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }),
  );
}

export async function getBucketLifecycle(
  client: S3Client,
  bucket: string,
): Promise<LifecycleRule[]> {
  try {
    const { GetBucketLifecycleConfigurationCommand } = await getS3Sdk();
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
  const { PutBucketLifecycleConfigurationCommand } = await getS3Sdk();
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: { Rules: rules },
    }),
  );
}
