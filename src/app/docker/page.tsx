import { TechPageShell } from "@/components/tech-page-shell";
import { getTech } from "@/lib/tech-catalog";
import { notFound } from "next/navigation";
import { DockerClient } from "./docker-client";

export default function DockerPage() {
  const tech = getTech("docker");
  if (!tech) notFound();
  return (
    <TechPageShell tech={tech}>
      <DockerClient />
    </TechPageShell>
  );
}
