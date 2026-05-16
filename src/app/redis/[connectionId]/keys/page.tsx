import { KeysClient } from "./keys-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function RedisKeysPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <KeysClient connectionId={connectionId} />;
}
