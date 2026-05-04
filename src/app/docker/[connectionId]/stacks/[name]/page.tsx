import { StackDetailClient } from "./stack-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; name: string }>;
}

export default async function StackDetailPage({ params }: PageProps) {
  const { connectionId, name } = await params;
  return (
    <StackDetailClient
      connectionId={connectionId}
      name={decodeURIComponent(name)}
    />
  );
}
