import "server-only";
import type { S3Client } from "@aws-sdk/client-s3";
import { getCachedClient, dropCachedClient, createS3Client } from "./s3";
import type { R2Config } from "./types";

/** The account id is the endpoint's first host label; anything else would pick the host. */
export function endpointFor(accountId: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(accountId)) throw new Error(`Invalid R2 account ID: ${JSON.stringify(accountId)}`);
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export async function r2ClientFor(connectionId: string, cfg: R2Config): Promise<S3Client> {
  const endpoint = endpointFor(cfg.accountId);
  return getCachedClient(
    `r2:${connectionId}`,
    JSON.stringify([cfg.accountId, cfg.accessKeyId, cfg.secretAccessKey]),
    () =>
      createS3Client({
        region: "auto",
        endpoint,
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
