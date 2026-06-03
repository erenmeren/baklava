import { BlobWorkspaceLayout } from "@/components/blob/blob-workspace-layout";

export const dynamic = "force-dynamic";

export default async function S3WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}) {
  const { connectionId } = await params;
  return (
    <BlobWorkspaceLayout tech="s3" connectionId={connectionId}>
      {children}
    </BlobWorkspaceLayout>
  );
}
