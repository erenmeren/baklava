import "server-only";
import { S3Client } from "@aws-sdk/client-s3";
import { getCachedClient, dropCachedClient } from "./s3";
import type { S3Config } from "./types";

export function endpointFor(region: string): string {
  return `https://s3.${region}.amazonaws.com`;
}

export function s3AwsClientFor(connectionId: string, cfg: S3Config): S3Client {
  return getCachedClient(
    `s3:${connectionId}`,
    JSON.stringify([cfg.region, cfg.accessKeyId, cfg.secretAccessKey, cfg.sessionToken ?? ""]),
    () =>
      new S3Client({
        region: cfg.region || "us-east-1",
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
          sessionToken: cfg.sessionToken || undefined,
        },
        requestHandler: { requestTimeout: 15_000 },
      }),
  );
}

export function dropS3Client(connectionId: string): void {
  dropCachedClient(`s3:${connectionId}`);
}
