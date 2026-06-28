import { requireLoadTest } from "@/lib/loadtest/server";
import { HistoryClient } from "./history-client";

export default async function HistoryPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  const test = await requireLoadTest(testId);
  return <HistoryClient testId={testId} testName={test.name} />;
}
