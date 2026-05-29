import { requireConnection } from "@/lib/connections/server";
import type { MysqlConfig } from "@/lib/connections/types";
import { ProcessListClient } from "./processlist-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function MysqlProcessListPage({ params }: PageProps) {
  const { connectionId } = await params;
  const record = requireConnection<MysqlConfig>(connectionId, "mysql");
  return (
    <ProcessListClient
      connectionId={connectionId}
      connectionName={record.name}
    />
  );
}
