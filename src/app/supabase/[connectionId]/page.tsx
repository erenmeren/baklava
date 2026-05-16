import { OverviewClient } from "./overview-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SupabaseOverviewPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <OverviewClient connectionId={connectionId} />;
}
