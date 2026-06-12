import { redirect } from "next/navigation";

export default async function LoadTestIndex({ params }: { params: Promise<{ testId: string }> }) {
  const { testId } = await params;
  redirect(`/loadtest/${testId}/run`);
}
