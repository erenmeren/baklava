import { NetworksClient } from "./networks-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function NetworksPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <NetworksClient connectionId={connectionId} />;
}
