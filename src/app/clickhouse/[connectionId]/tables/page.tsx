import { TablesClient } from "./tables-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function TablesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <TablesClient connectionId={connectionId} />;
}
