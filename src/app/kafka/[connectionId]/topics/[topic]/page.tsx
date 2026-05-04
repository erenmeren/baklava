import { TopicDetailClient } from "./topic-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; topic: string }>;
}

export default async function TopicDetailPage({ params }: PageProps) {
  const { connectionId, topic } = await params;
  return (
    <TopicDetailClient
      connectionId={connectionId}
      topic={decodeURIComponent(topic)}
    />
  );
}
