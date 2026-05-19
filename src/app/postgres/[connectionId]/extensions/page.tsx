import { requireConnection } from "@/lib/connections/server";
import type { PostgresConfig } from "@/lib/connections/types";
import { ExtensionsClient } from "./extensions-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function PostgresExtensionsPage({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<PostgresConfig>(connectionId, "postgres");
  return (
    <ExtensionsClient
      connectionId={connectionId}
      defaultDatabase={record.config.database}
    />
  );
}
