import { requireConnection } from "@/lib/connections/server";
import type { MinioConfig } from "@/lib/connections/types";
import { minioClientFor, resolveEndpoint } from "@/lib/connections/minio";
import { probeCached } from "@/lib/connections/s3";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string }>; }

export default async function MinioOverview({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<MinioConfig>(connectionId, "minio");
  const { buckets } = await probeCached(minioClientFor(connectionId, record.config)).catch(() => ({ buckets: 0 }));
  return (
    <WorkspacePage title="Overview" description="MinIO object storage">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd className="font-mono break-all">{resolveEndpoint(record.config)}</dd>
        <dt className="text-muted-foreground">Region</dt>
        <dd className="font-mono">{record.config.region || "us-east-1"}</dd>
        <dt className="text-muted-foreground">Buckets</dt>
        <dd className="font-mono">{buckets}</dd>
      </dl>
    </WorkspacePage>
  );
}
