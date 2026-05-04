import { QueryEditorClient } from "./query-editor-client";

interface PageProps {
  params: Promise<{ connectionId: string; db: string }>;
}

export default async function QueryEditorPage({ params }: PageProps) {
  const { connectionId, db } = await params;
  return (
    <QueryEditorClient
      connectionId={connectionId}
      db={decodeURIComponent(db)}
    />
  );
}
