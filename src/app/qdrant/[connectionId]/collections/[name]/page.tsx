import { requireConnection } from "@/lib/connections/server";
import type { QdrantConfig } from "@/lib/connections/types";
import { getCollection } from "@/lib/connections/qdrant";
import { formatError } from "@/lib/errors";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { CollectionDetailClient } from "./collection-detail-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string; name: string }>;
}

export default async function CollectionDetailPage({ params }: Props) {
  const { connectionId, name } = await params;
  const decodedName = decodeURIComponent(name);
  const record = requireConnection<QdrantConfig>(connectionId, "qdrant");
  const result = await getCollection(record.config, decodedName).then(
    (detail) => ({ ok: true as const, detail }),
    (err: unknown) => ({ ok: false as const, error: formatError(err) }),
  );

  return (
    <WorkspacePage
      title={decodedName}
      description="Inspect points, run similarity search, and view config."
    >
      <CollectionDetailClient
        connectionId={connectionId}
        name={decodedName}
        initial={result}
      />
    </WorkspacePage>
  );
}
