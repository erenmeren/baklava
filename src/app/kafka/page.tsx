import { TechPageShell } from "@/components/tech-page-shell";
import { getTech } from "@/lib/tech-catalog";
import { notFound } from "next/navigation";
import { KafkaClient } from "./kafka-client";

export default function KafkaPage() {
  const tech = getTech("kafka");
  if (!tech) notFound();
  return (
    <TechPageShell tech={tech}>
      <KafkaClient />
    </TechPageShell>
  );
}
