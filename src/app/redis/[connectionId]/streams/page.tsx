import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { StreamsClient } from "./streams-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function StreamsPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<RedisConfig>(connectionId, "redis");
  return (
    <WorkspacePage
      title="Streams"
      description="Browse Redis Streams with XRANGE/XREVRANGE. Use the Keys page to discover stream keys first."
    >
      <StreamsClient
        connectionId={connectionId}
        isCluster={record.config.mode === "cluster"}
      />
    </WorkspacePage>
  );
}
