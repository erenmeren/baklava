import { requireConnection } from "@/lib/connections/server";
import type { PostgresConfig } from "@/lib/connections/types";
import { DatabaseOverviewClient } from "./database-overview-client";

interface PageProps {
  params: Promise<{ connectionId: string; db: string }>;
}

export default async function DatabaseOverviewPage({ params }: PageProps) {
  const { connectionId, db } = await params;
  // requireConnection 404s if the connection vanished; we don't actually
  // need the record fields client-side beyond `name`, but the call
  // ensures consistent behavior with the rest of the workspace.
  const record = await requireConnection<PostgresConfig>(connectionId, "postgres");
  return (
    <DatabaseOverviewClient
      connectionId={connectionId}
      connectionName={record.name}
      database={decodeURIComponent(db)}
    />
  );
}
