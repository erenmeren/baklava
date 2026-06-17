import "server-only";
import type { S3Client } from "@aws-sdk/client-s3";
import { getCachedClient, dropCachedClient, createS3Client } from "./s3";
import type { R2Config } from "./types";

export function endpointFor(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export async function r2ClientFor(connectionId: string, cfg: R2Config): Promise<S3Client> {
  return getCachedClient(
    `r2:${connectionId}`,
    JSON.stringify([cfg.accountId, cfg.accessKeyId, cfg.secretAccessKey]),
    () =>
      createS3Client({
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
