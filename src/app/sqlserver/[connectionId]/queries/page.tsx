import { ExpensiveQueriesClient } from "./expensive-queries-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function SqlServerQueriesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <ExpensiveQueriesClient connectionId={connectionId} />;
}
