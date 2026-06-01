import { requireConnection } from "@/lib/connections/server";
import type { MinioConfig } from "@/lib/connections/types";
import { BucketClient } from "@/components/blob/bucket-client";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string; bucket: string }>; }

export default async function BucketPage({ params }: PageProps) {
  const { connectionId, bucket } = await params;
  requireConnection<MinioConfig>(connectionId, "minio");
  return <BucketClient tech="minio" connectionId={connectionId} bucket={decodeURIComponent(bucket)} />;
}
