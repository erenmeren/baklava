import { FunctionsClient } from "./functions-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function FunctionsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <FunctionsClient connectionId={connectionId} />;
}
