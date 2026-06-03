import { BlobWorkspaceLayout } from "@/components/blob/blob-workspace-layout";

export const dynamic = "force-dynamic";

export default async function MinioWorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ connectionId: string }>;
  children: React.ReactNode;
}) {
  const { connectionId } = await params;
  return (
    <BlobWorkspaceLayout tech="minio" connectionId={connectionId}>
      {children}
    </BlobWorkspaceLayout>
  );
}
