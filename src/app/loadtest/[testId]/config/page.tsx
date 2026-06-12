import { ConfigClient } from "./config-client";

export default async function ConfigPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  return <ConfigClient testId={testId} />;
}
