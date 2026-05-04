import { ImagesClient } from "./images-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function ImagesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <ImagesClient connectionId={connectionId} />;
}
