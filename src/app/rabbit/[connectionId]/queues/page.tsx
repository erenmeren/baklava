import { QueuesClient } from "./queues-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function RabbitQueuesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <QueuesClient connectionId={connectionId} />;
}
