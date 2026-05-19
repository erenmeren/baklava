import { DiagnosticsClient } from "./diagnostics-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function PostgresDiagnosticsPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <DiagnosticsClient connectionId={connectionId} />;
}
