import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ connectionId: string; db: string }>;
}

function freshQueryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export default async function QueryEditorRedirect({ params }: PageProps) {
  const { connectionId, db } = await params;
  redirect(
    `/mysql/${connectionId}/databases/${encodeURIComponent(db)}/query/${freshQueryId()}`,
  );
}
