import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function DockerWorkspaceIndex({ params }: PageProps) {
  const { connectionId } = await params;
  redirect(`/docker/${connectionId}/containers`);
}
