import { BrokersClient } from "./brokers-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function BrokersPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <BrokersClient connectionId={connectionId} />;
}
