import { StreamDetailClient } from "./stream-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; name: string }>;
}

export default async function NatsStreamDetailPage({ params }: PageProps) {
  const { connectionId, name } = await params;
  return (
    <StreamDetailClient
      connectionId={connectionId}
      name={decodeURIComponent(name)}
    />
  );
}
