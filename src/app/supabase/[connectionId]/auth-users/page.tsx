import { AuthUsersClient } from "./auth-users-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function AuthUsersPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <AuthUsersClient connectionId={connectionId} />;
}
