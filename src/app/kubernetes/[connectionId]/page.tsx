import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function KubernetesIndex({ params }: Props) {
  const { connectionId } = await params;
  redirect(`/kubernetes/${connectionId}/pods`);
}
