import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function KafkaWorkspaceIndex({ params }: PageProps) {
  const { connectionId } = await params;
  redirect(`/kafka/${connectionId}/topics`);
}
