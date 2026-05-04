import { TechPageShell } from "@/components/tech-page-shell";
import { getTech } from "@/lib/tech-catalog";
import { notFound } from "next/navigation";
import { PostgresClient } from "./postgres-client";

export default function PostgresPage() {
  const tech = getTech("postgres");
  if (!tech) notFound();
  return (
    <TechPageShell tech={tech}>
      <PostgresClient />
    </TechPageShell>
  );
}
