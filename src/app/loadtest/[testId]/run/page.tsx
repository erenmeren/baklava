import { requireLoadTest } from "@/lib/loadtest/server";
import { RunClient } from "./run-client";

export default async function RunPage({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  const test = requireLoadTest(testId);
  return <RunClient testId={testId} testName={test.name} />;
}
