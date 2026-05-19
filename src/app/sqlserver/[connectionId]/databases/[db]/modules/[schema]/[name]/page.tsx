import { ModuleDetailClient } from "./module-detail-client";

interface PageProps {
  params: Promise<{
    connectionId: string;
    db: string;
    schema: string;
    name: string;
  }>;
}

export default async function SqlServerModulePage({ params }: PageProps) {
  const { connectionId, db, schema, name } = await params;
  return (
    <ModuleDetailClient
      connectionId={connectionId}
      database={decodeURIComponent(db)}
      schema={decodeURIComponent(schema)}
      name={decodeURIComponent(name)}
    />
  );
}
