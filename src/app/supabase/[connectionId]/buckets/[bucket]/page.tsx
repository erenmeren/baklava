import { BucketDetailClient } from "./bucket-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; bucket: string }>;
}

export default async function BucketDetailPage({ params }: PageProps) {
  const { connectionId, bucket } = await params;
  return (
    <BucketDetailClient
      connectionId={connectionId}
      bucketName={decodeURIComponent(bucket)}
    />
  );
}
