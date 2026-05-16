import { KeyDetailClient } from "./key-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; key: string }>;
}

export default async function EtcdKeyDetailPage({ params }: PageProps) {
  const { connectionId, key } = await params;
  return (
    <KeyDetailClient
      connectionId={connectionId}
      keyName={decodeURIComponent(key)}
    />
  );
}
