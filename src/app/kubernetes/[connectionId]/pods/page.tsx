import { PodsClient } from "./pods-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function PodsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <PodsClient connectionId={connectionId} />;
}
