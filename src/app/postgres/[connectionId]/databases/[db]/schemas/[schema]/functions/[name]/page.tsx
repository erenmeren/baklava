import { FunctionDetailClient } from "./function-detail-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    connectionId: string;
    db: string;
    schema: string;
    name: string;
  }>;
  searchParams: Promise<{ args?: string }>;
}

export default async function FunctionDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { connectionId, db, schema, name } = await params;
  const { args = "" } = await searchParams;
  return (
    <FunctionDetailClient
      connectionId={connectionId}
      db={decodeURIComponent(db)}
      schema={decodeURIComponent(schema)}
      name={decodeURIComponent(name)}
      argSignature={args}
    />
  );
}
