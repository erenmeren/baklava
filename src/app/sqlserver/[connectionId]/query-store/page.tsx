import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";
import { QueryStoreClient } from "./query-store-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SqlServerQueryStorePage({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<SqlServerConfig>(connectionId, "sqlserver");
  return (
    <QueryStoreClient connectionId={connectionId} defaultDatabase={record.config.database} />
  );
}
