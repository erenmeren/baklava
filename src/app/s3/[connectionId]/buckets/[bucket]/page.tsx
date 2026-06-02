import { requireConnection } from "@/lib/connections/server";
import type { S3Config } from "@/lib/connections/types";
import { BucketClient } from "@/components/blob/bucket-client";

export const dynamic = "force-dynamic";

interface PageProps { params: Promise<{ connectionId: string; bucket: string }>; }

export default async function BucketPage({ params }: PageProps) {
  const { connectionId, bucket } = await params;
  requireConnection<S3Config>(connectionId, "s3");
  return <BucketClient tech="s3" connectionId={connectionId} bucket={decodeURIComponent(bucket)} />;
}
