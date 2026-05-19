import { requireConnection } from "@/lib/connections/server";
import type { SqlServerConfig } from "@/lib/connections/types";
import { IndexesClient } from "./indexes-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SqlServerIndexesPage({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<SqlServerConfig>(connectionId, "sqlserver");
  return (
    <IndexesClient connectionId={connectionId} defaultDatabase={record.config.database} />
  );
}
