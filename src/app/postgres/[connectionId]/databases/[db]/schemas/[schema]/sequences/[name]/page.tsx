import { SequenceDetailClient } from "./sequence-detail-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    connectionId: string;
    db: string;
    schema: string;
    name: string;
  }>;
}

export default async function SequenceDetailPage({ params }: PageProps) {
  const { connectionId, db, schema, name } = await params;
  return (
    <SequenceDetailClient
      connectionId={connectionId}
      db={decodeURIComponent(db)}
      schema={decodeURIComponent(schema)}
      name={decodeURIComponent(name)}
    />
  );
}
