import { DatabaseDetailClient } from "./database-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; db: string }>;
}

export default async function MysqlDatabaseDetailPage({ params }: PageProps) {
  const { connectionId, db } = await params;
  return (
    <DatabaseDetailClient
      connectionId={connectionId}
      database={decodeURIComponent(db)}
    />
  );
}
