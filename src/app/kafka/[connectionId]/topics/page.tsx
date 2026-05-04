import { TopicsClient } from "./topics-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function TopicsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <TopicsClient connectionId={connectionId} />;
}
