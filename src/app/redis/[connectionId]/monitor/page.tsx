import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import { MonitorClient } from "./monitor-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function MonitorPage({ params }: Props) {
  const { connectionId } = await params;
  requireConnection<RedisConfig>(connectionId, "redis");
  return <MonitorClient connectionId={connectionId} />;
}
