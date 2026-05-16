import { StreamsClient } from "./streams-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function NatsStreamsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <StreamsClient connectionId={connectionId} />;
}
