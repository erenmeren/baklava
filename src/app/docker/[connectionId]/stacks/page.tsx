import { StacksClient } from "./stacks-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function StacksPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <StacksClient connectionId={connectionId} />;
}
