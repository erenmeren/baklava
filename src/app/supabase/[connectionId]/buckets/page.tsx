import { BucketsClient } from "./buckets-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function BucketsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <BucketsClient connectionId={connectionId} />;
}
