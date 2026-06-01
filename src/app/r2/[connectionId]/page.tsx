import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { endpointFor, r2ClientFor } from "@/lib/connections/r2";
import { listBuckets } from "@/lib/connections/s3";
import { WorkspacePage } from "@/components/workspace/workspace-page";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string }>; }

export default async function R2Overview({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<R2Config>(connectionId, "r2");
  const buckets = await listBuckets(r2ClientFor(connectionId, record.config)).catch(() => []);
  return (
    <WorkspacePage title="Overview" description="Cloudflare R2 object storage">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Account ID</dt>
        <dd className="font-mono">{record.config.accountId}</dd>
        <dt className="text-muted-foreground">Endpoint</dt>
        <dd className="font-mono break-all">{endpointFor(record.config.accountId)}</dd>
        <dt className="text-muted-foreground">Buckets</dt>
        <dd className="font-mono">{buckets.length}</dd>
      </dl>
    </WorkspacePage>
  );
}
