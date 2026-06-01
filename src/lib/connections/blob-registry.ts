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
