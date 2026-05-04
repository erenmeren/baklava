import { GroupDetailClient } from "./group-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; group: string }>;
}

export default async function GroupDetailPage({ params }: PageProps) {
  const { connectionId, group } = await params;
  return (
    <GroupDetailClient
      connectionId={connectionId}
      group={decodeURIComponent(group)}
    />
  );
}
