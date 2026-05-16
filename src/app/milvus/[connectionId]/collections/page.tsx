import { CollectionsClient } from "./collections-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function MilvusCollectionsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <CollectionsClient connectionId={connectionId} />;
}
