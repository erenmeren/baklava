import { SystemClient } from "./system-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SystemPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <SystemClient connectionId={connectionId} />;
}
