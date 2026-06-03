import { requireConnection } from "@/lib/connections/server";
import type { S3Config } from "@/lib/connections/types";
import { endpointFor, s3AwsClientFor } from "@/lib/connections/s3-aws";
import { probeCached } from "@/lib/connections/s3";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string }>; }

export default async function S3Overview({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<S3Config>(connectionId, "s3");
  const { buckets } = await probeCached(s3AwsClientFor(connectionId, record.config)).catch(() => ({ buckets: 0 }));
  return (
    <WorkspacePage title="Overview" description="Amazon S3 object storage">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Region</dt>
        <dd className="font-mono">{record.config.region}</dd>
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd className="font-mono break-all">{endpointFor(record.config.region)}</dd>
        <dt className="text-muted-foreground">Buckets</dt>
        <dd className="font-mono">{buckets}</dd>
      </dl>
    </WorkspacePage>
  );
}
