import { TableDetailClient } from "./table-detail-client";

interface PageProps {
  params: Promise<{
    connectionId: string;
    db: string;
    schema: string;
    table: string;
  }>;
}

export default async function TableDetailPage({ params }: PageProps) {
  const { connectionId, db, schema, table } = await params;
  return (
    <TableDetailClient
      connectionId={connectionId}
      db={decodeURIComponent(db)}
      schema={decodeURIComponent(schema)}
      table={decodeURIComponent(table)}
    />
  );
}
