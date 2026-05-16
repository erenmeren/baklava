import { DatabasesClient } from "./databases-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function MysqlDatabasesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <DatabasesClient connectionId={connectionId} />;
}
