import { requireConnection } from "@/lib/connections/server";
import type { R2Config } from "@/lib/connections/types";
import { BucketClient } from "./bucket-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string; bucket: string }>;
}

export default async function BucketPage({ params }: PageProps) {
  const { connectionId, bucket } = await params;
  requireConnection<R2Config>(connectionId, "r2");
  return <BucketClient connectionId={connectionId} bucket={decodeURIComponent(bucket)} />;
}
