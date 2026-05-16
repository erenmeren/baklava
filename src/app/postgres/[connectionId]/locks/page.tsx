import { LocksClient } from "./locks-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function PostgresLocksPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <LocksClient connectionId={connectionId} />;
}
