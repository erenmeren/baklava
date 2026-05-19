import { LocksClient } from "./locks-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SqlServerLocksPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <LocksClient connectionId={connectionId} />;
}
