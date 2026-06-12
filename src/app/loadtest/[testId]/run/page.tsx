import { RunClient } from "./run-client";

export default async function RunPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  return <RunClient testId={testId} />;
}
