import { PodDetailClient } from "./pod-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; namespace: string; name: string }>;
}

export default async function PodDetailPage({ params }: PageProps) {
  const { connectionId, namespace, name } = await params;
  return (
    <PodDetailClient
      connectionId={connectionId}
      namespace={decodeURIComponent(namespace)}
      name={decodeURIComponent(name)}
    />
  );
}
