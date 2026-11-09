import "server-only";
import type { S3Client } from "@aws-sdk/client-s3";
import { getCachedClient, dropCachedClient, createS3Client } from "./s3";
import type { S3Config } from "./types";

/** The region lands in the endpoint host, so it must be a plain DNS label. */
function checkRegion(region: string): string {
  if (!/^[a-z0-9-]+$/.test(region)) throw new Error(`Invalid S3 region: ${JSON.stringify(region)}`);
  return region;
}

export function endpointFor(region: string): string {
  return `https://s3.${checkRegion(region)}.amazonaws.com`;
}

export async function s3AwsClientFor(connectionId: string, cfg: S3Config): Promise<S3Client> {
  const region = checkRegion(cfg.region || "us-east-1");
  return getCachedClient(
    `s3:${connectionId}`,
    JSON.stringify([cfg.region, cfg.accessKeyId, cfg.secretAccessKey, cfg.sessionToken ?? ""]),
    () =>
      createS3Client({
        region,
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
