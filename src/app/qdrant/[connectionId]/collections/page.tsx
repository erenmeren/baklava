import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { listCollections } from "@/lib/connections/qdrant";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { CollectionsClient } from "./collections-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function CollectionsPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<QdrantConfig>(connectionId, "qdrant");
  const result = await listCollections(record.config).then(
    (collections) => ({ ok: true as const, collections }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );

  return (
    <WorkspacePage
      title="Collections"
      description="Vector collections on this Qdrant instance."
    >
      <CollectionsClient connectionId={connectionId} initial={result} />
    </WorkspacePage>
  );
}
