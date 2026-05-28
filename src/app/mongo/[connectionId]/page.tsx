import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ connectionId: string }>;
}

export default async function MongoIndex({ params }: Props) {
  const { connectionId } = await params;
  redirect(`/mongo/${connectionId}/databases`);
}
