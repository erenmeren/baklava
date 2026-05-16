import { DatabasesClient } from "./databases-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function MongoDatabasesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <DatabasesClient connectionId={connectionId} />;
}
