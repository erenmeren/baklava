import { NewStackClient } from "./new-stack-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function NewStackPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <NewStackClient connectionId={connectionId} />;
}
