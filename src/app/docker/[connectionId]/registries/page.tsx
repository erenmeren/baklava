import { RegistriesClient } from "./registries-client";

interface PageProps {
  params: Promise<{ connectionId: string }>;
}

export default async function RegistriesPage({ params }: PageProps) {
  const { connectionId } = await params;
  return <RegistriesClient connectionId={connectionId} />;
}
