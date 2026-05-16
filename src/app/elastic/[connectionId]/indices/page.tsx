import { IndicesClient } from "./indices-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function IndicesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <IndicesClient connectionId={connectionId} />;
}
