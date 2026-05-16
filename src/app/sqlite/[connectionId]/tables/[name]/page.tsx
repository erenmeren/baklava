import { TableDetailClient } from "./table-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; name: string }>;
}

export default async function SqliteTableDetailPage({ params }: PageProps) {
  const { connectionId, name } = await params;
  return (
    <TableDetailClient
      connectionId={connectionId}
      tableName={decodeURIComponent(name)}
    />
  );
}
