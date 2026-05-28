import { requireConnection } from "@/lib/connections/server";
import type { MongoConfig } from "@/lib/connections/types";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { CurrentOpClient } from "./current-op-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function CurrentOpPage({ params }: Props) {
  const { connectionId } = await params;
  requireConnection<MongoConfig>(connectionId, "mongo");
  return (
    <WorkspacePage
      title="Current operations"
      description="db.currentOp() — what's running on the server right now. Long-running or lock-waiting ops are the usual culprits behind slow Mongo."
    >
      <CurrentOpClient connectionId={connectionId} />
    </WorkspacePage>
  );
}
