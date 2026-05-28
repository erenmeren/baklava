import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { CollectionClient } from "./collection-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string; db: string; coll: string }>;
}

export default async function CollectionPage({ params }: Props) {
  const { connectionId, db, coll } = await params;
  requireConnection<MongoConfig>(connectionId, "mongo");
  const dbName = decodeURIComponent(db);
  const collName = decodeURIComponent(coll);
  return (
    <WorkspacePage
      title={`${dbName}.${collName}`}
      description="Documents, indexes, and aggregation pipeline."
    >
      <CollectionClient
        connectionId={connectionId}
        dbName={dbName}
        collName={collName}
      />
    </WorkspacePage>
  );
}
