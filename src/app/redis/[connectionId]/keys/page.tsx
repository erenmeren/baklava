import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import { KeysClient } from "./keys-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function KeysPage({ params }: Props) {
  const { connectionId } = await params;
  const record = requireConnection<RedisConfig>(connectionId, "redis");
  return (
    <KeysClient
      connectionId={connectionId}
      isCluster={record.config.mode === "cluster"}
      defaultDb={record.config.db ?? 0}
    />
  );
}
