import { ContainerDetailClient } from "./container-detail-client";

interface PageProps {
  params: Promise<{ connectionId: string; cid: string }>;
}

export default async function ContainerDetailPage({ params }: PageProps) {
  const { connectionId, cid } = await params;
  return <ContainerDetailClient connectionId={connectionId} cid={cid} />;
}
