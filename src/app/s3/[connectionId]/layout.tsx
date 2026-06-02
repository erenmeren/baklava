import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { S3Config } from "@/lib/connections/types";
import { s3AwsClientFor } from "@/lib/connections/s3-aws";
import { probe } from "@/lib/connections/s3";
import { BucketSidebar } from "@/components/blob/bucket-sidebar";
import { BucketTabs } from "@/components/blob/bucket-tabs";

export const dynamic = "force-dynamic";

interface LayoutProps { params: Promise<{ connectionId: string }>; children: React.ReactNode; }

export default async function S3WorkspaceLayout({ params, children }: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<S3Config>(connectionId, "s3");
  const tech = getTech("s3")!;
  const result = await probe(s3AwsClientFor(connectionId, record.config)).catch(() => null);
  const subtitle = result ? `${result.buckets} bucket(s)` : "unreachable";
  return (
    <WorkspaceShell tech={tech} connectionName={record.name} subtitle={subtitle}
      sidebar={<BucketSidebar tech="s3" connectionId={connectionId} defaultBucket={record.config.bucket ?? ""} />}>
      <div className="flex flex-col h-full min-h-0">
        <BucketTabs tech="s3" connectionId={connectionId} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
