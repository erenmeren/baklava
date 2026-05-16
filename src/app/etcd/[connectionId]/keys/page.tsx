import { KeysClient } from "./keys-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function EtcdKeysPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <KeysClient connectionId={connectionId} />;
}
