import { CollectionDetailClient } from "./collection-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; name: string }>;
}

export default async function ChromaCollectionDetailPage({ params }: PageProps) {
  const { connectionId, name } = await params;
  return (
    <CollectionDetailClient
      connectionId={connectionId}
      collectionName={decodeURIComponent(name)}
    />
  );
}
