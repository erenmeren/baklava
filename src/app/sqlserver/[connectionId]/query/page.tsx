import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";
import { QueryEditorClient } from "./query-editor-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SqlServerQueryPage({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<SqlServerConfig>(connectionId, "sqlserver");
  return (
    <QueryEditorClient
      connectionId={connectionId}
      defaultDatabase={record.config.database}
    />
  );
}
