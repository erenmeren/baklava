import { EventsClient } from "./events-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function EventsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <EventsClient connectionId={connectionId} />;
}
