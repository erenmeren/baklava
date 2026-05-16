import { ActivityClient } from "./activity-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function PostgresActivityPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <ActivityClient connectionId={connectionId} />;
}
