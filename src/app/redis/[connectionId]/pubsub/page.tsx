import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import { PubSubClient } from "./pubsub-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function PubSubPage({ params }: Props) {
  const { connectionId } = await params;
  requireConnection<RedisConfig>(connectionId, "redis");
  return <PubSubClient connectionId={connectionId} />;
}
