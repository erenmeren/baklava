import { ConsumerGroupsClient } from "./consumer-groups-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function ConsumerGroupsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <ConsumerGroupsClient connectionId={connectionId} />;
}
