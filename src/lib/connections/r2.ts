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
