import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import { probeCached } from "@/lib/connections/s3";
import { blobTech } from "@/lib/connections/blob-registry";
import type { TechId } from "@/lib/connections/types";
import { BucketSidebar } from "./bucket-sidebar";
import { BucketTabs } from "./bucket-tabs";

/**
 * Shared workspace shell for the S3-compatible blob techs (R2 / MinIO / S3).
 * Each tech's `layout.tsx` is a thin wrapper that passes its `tech`; the client
 * is resolved through the blob registry and the bucket-count probe is
 * request-deduplicated with the overview page via `probeCached`.
 */
export async function BlobWorkspaceLayout({
  tech,
  connectionId,
  children,
}: {
  tech: TechId;
  connectionId: string;
  children: React.ReactNode;
}) {
  const record = requireConnection(connectionId, tech);
  const meta = getTech(tech)!;
  const client = await blobTech(tech)!.clientFor(connectionId, record.config);
  const result = await probeCached(client).catch(() => null);
  const subtitle = result ? `${result.buckets} bucket(s)` : "unreachable";
  const defaultBucket = (record.config as { bucket?: string }).bucket ?? "";

  return (
    <WorkspaceShell
      tech={meta}
      connectionName={record.name}
      connectionId={connectionId}
      subtitle={subtitle}
      sidebar={
        <BucketSidebar
          tech={tech}
          connectionId={connectionId}
          defaultBucket={defaultBucket}
        />
      }
    >
      <div className="flex flex-col h-full min-h-0">
        <BucketTabs tech={tech} connectionId={connectionId} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
