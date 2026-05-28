import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function RedisIndex({ params }: Props) {
  const { connectionId } = await params;
  redirect(`/redis/${connectionId}/keys`);
}
