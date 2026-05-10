import { RolesClient } from "./roles-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function RolesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <RolesClient connectionId={connectionId} />;
}
