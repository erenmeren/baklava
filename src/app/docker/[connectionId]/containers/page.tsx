import { ContainersClient } from "./containers-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function ContainersPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <ContainersClient connectionId={connectionId} />;
}
