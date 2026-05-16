import { IndexDetailClient } from "./index-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; name: string }>;
}

export default async function IndexDetailPage({ params }: PageProps) {
  const { connectionId, name } = await params;
  return (
    <IndexDetailClient
      connectionId={connectionId}
      name={decodeURIComponent(name)}
    />
  );
}
