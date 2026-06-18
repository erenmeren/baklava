import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function QdrantRootPage({ params }: Props) {
  const { connectionId } = await params;
  redirect(`/qdrant/${connectionId}/collections`);
}
