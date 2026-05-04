import { VolumesClient } from "./volumes-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function VolumesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <VolumesClient connectionId={connectionId} />;
}
