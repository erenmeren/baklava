import { requireConnection } from "@/lib/connections/server";
import type { MysqlConfig } from "@/lib/connections/types";
import { QueryEditorClient } from "../query-editor-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string; db: string; queryId: string }>;
}

export default async function QueryEditorPage({ params }: PageProps) {
  const { connectionId, db, queryId } = await params;
  // 404s if the connection is missing or isn't a MySQL connection.
  requireConnection<MysqlConfig>(connectionId, "mysql");
  return (
    <QueryEditorClient
      connectionId={connectionId}
      db={decodeURIComponent(db)}
      queryId={queryId}
    />
  );
}
