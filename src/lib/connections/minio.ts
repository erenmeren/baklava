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
