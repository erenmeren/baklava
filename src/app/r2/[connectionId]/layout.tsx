import { WorkspaceShell } from "@/components/workspace/workspace-shell";
import { getTech } from "@/lib/tech-catalog";
import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { r2ClientFor } from "@/lib/connections/r2";
import { probe } from "@/lib/connections/s3";
import { BucketSidebar } from "@/components/blob/bucket-sidebar";
import { BucketTabs } from "@/components/blob/bucket-tabs";

export const dynamic = "force-dynamic";

interface LayoutProps {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}

export default async function R2WorkspaceLayout({ params, children }: LayoutProps) {
  const { connectionId } = await params;
  const record = requireConnection<R2Config>(connectionId, "r2");
  const tech = getTech("r2")!;
  const result = await probe(r2ClientFor(connectionId, record.config)).catch(() => null);
  const subtitle = result ? `${result.buckets} bucket(s)` : "unreachable";
  return (
    <WorkspaceShell tech={tech} connectionName={record.name} connectionId={connectionId} subtitle={subtitle}
      sidebar={<BucketSidebar tech="r2" connectionId={connectionId} defaultBucket={record.config.bucket ?? ""} />}>
      <div className="flex flex-col h-full min-h-0">
        <BucketTabs tech="r2" connectionId={connectionId} />
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </WorkspaceShell>
  );
}
