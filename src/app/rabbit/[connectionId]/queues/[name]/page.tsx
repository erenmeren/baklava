import { QueueDetailClient } from "./queue-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; name: string }>;
}

export default async function RabbitQueueDetailPage({ params }: PageProps) {
  const { connectionId, name } = await params;
  return (
    <QueueDetailClient
      connectionId={connectionId}
      name={decodeURIComponent(name)}
    />
  );
}
