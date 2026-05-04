import type { TechId } from "./connections/types";
import type { LucideIcon } from "lucide-react";
import { Container, Database, Network } from "lucide-react";

export interface TechMeta {
  id: TechId;
  name: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  color: string;
  status: "available" | "coming-soon";
}

export const TECH_CATALOG: TechMeta[] = [
  {
    id: "docker",
    name: "Docker",
    tagline: "Container engine",
    description: "Inspect and manage containers, images, networks and volumes.",
    icon: Container,
    color: "from-sky-400 to-blue-600",
    status: "available",
  },
  {
    id: "kafka",
    name: "Kafka",
    tagline: "Streaming platform",
    description: "Browse topics, partitions and consumer groups.",
    icon: Network,
    color: "from-orange-400 to-red-600",
    status: "available",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    tagline: "Relational database",
    description: "Run queries, browse schemas and inspect tables.",
    icon: Database,
    color: "from-indigo-400 to-violet-600",
    status: "available",
  },
];

export function getTech(id: string): TechMeta | undefined {
  return TECH_CATALOG.find((t) => t.id === id);
}
