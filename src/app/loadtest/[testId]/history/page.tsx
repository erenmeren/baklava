import { HistoryClient } from "./history-client";

export default async function HistoryPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  return <HistoryClient testId={testId} />;
}
