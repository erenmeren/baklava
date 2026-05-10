import { QueryEditorClient } from "../query-editor-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string; db: string; queryId: string }>;
}

export default async function QueryEditorPage({ params }: PageProps) {
  const { connectionId, db, queryId } = await params;
  return (
    <QueryEditorClient
      connectionId={connectionId}
      db={decodeURIComponent(db)}
      queryId={queryId}
    />
  );
}
