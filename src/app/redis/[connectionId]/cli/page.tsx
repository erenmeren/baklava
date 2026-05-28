import { requireConnection } from "@/lib/connections/server";
import type { RedisConfig } from "@/lib/connections/types";
import { CliClient } from "./cli-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function CliPage({ params }: Props) {
  const { connectionId } = await params;
  requireConnection<RedisConfig>(connectionId, "redis");
  return <CliClient connectionId={connectionId} />;
}
