import { BlobWorkspaceLayout } from "@/components/blob/blob-workspace-layout";

export const dynamic = "force-dynamic";

export default async function R2WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}) {
  const { connectionId } = await params;
  return (
    <BlobWorkspaceLayout tech="r2" connectionId={connectionId}>
      {children}
    </BlobWorkspaceLayout>
  );
}
