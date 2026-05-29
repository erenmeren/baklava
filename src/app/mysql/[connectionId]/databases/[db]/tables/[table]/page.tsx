import { requireConnection } from "@/lib/connections/server";
import type { MysqlConfig } from "@/lib/connections/types";
import { TableDetailClient } from "./table-detail-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{
    connectionId: string;
    db: string;
    table: string;
  }>;
}

export default async function TableDetailPage({ params }: PageProps) {
  const { connectionId, db, table } = await params;
  await requireConnection<MysqlConfig>(connectionId, "mysql");
  return (
    <TableDetailClient
      connectionId={connectionId}
      db={decodeURIComponent(db)}
      table={decodeURIComponent(table)}
    />
  );
}
