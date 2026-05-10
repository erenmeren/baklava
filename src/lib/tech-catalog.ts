import type { LucideIcon } from "lucide-react";
import {
  Boxes,
  Container,
  Database,
  HardDrive,
  Network,
  Search,
} from "lucide-react";

export type TechCategory =
  | "Runtime"
  | "Database"
  | "Streaming"
  | "Cache"
  | "Search"
  | "Other";

export const TECH_CATEGORIES = [
  "All",
  "Runtime",
  "Database",
  "Streaming",
  "Cache",
  "Search",
] as const;

export type TechCategoryFilter = (typeof TECH_CATEGORIES)[number];

export interface TechMeta {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: TechCategory;
  icon: LucideIcon;
  /** simpleicons.org slug — used for the colorful home tile artwork */
  slug: string;
  /** Tailwind gradient classes — used by tech page / workspace shells */
  color: string;
  status: "available" | "coming-soon";
}

export const TECH_CATALOG: TechMeta[] = [
  {
    id: "docker",
    name: "Docker",
    tagline: "Container engine",
    description: "Inspect and manage containers, images, networks and volumes.",
    category: "Runtime",
    icon: Container,
    slug: "docker",
    color: "from-sky-400 to-blue-600",
    status: "available",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    tagline: "Relational database",
    description: "Run queries, browse schemas and inspect tables.",
    category: "Database",
    icon: Database,
    slug: "postgresql",
    color: "from-indigo-400 to-violet-600",
    status: "available",
  },
  {
    id: "kafka",
    name: "Kafka",
    tagline: "Streaming platform",
    description: "Browse topics, partitions and consumer groups.",
    category: "Streaming",
    icon: Network,
    slug: "apachekafka",
    color: "from-orange-400 to-red-600",
    status: "available",
  },
  {
    id: "redis",
    name: "Redis",
    tagline: "Key-value cache",
    description: "Keys, streams, pub/sub.",
    category: "Cache",
    icon: HardDrive,
    slug: "redis",
    color: "from-rose-400 to-red-600",
    status: "coming-soon",
  },
  {
    id: "mysql",
    name: "MySQL",
    tagline: "Relational database",
    description: "Tables, queries, replication.",
    category: "Database",
    icon: Database,
    slug: "mysql",
    color: "from-cyan-400 to-blue-600",
    status: "coming-soon",
  },
  {
    id: "mongo",
    name: "MongoDB",
    tagline: "Document database",
    description: "Collections, documents, aggregations.",
    category: "Database",
    icon: Database,
    slug: "mongodb",
    color: "from-emerald-400 to-green-600",
    status: "coming-soon",
  },
  {
    id: "rabbit",
    name: "RabbitMQ",
    tagline: "Message broker",
    description: "Queues, exchanges, bindings.",
    category: "Streaming",
    icon: Network,
    slug: "rabbitmq",
    color: "from-amber-400 to-orange-600",
    status: "coming-soon",
  },
  {
    id: "elastic",
    name: "Elasticsearch",
    tagline: "Search engine",
    description: "Indices, search, mappings.",
    category: "Search",
    icon: Search,
    slug: "elasticsearch",
    color: "from-teal-400 to-cyan-600",
    status: "coming-soon",
  },
  {
    id: "clickhouse",
    name: "ClickHouse",
    tagline: "OLAP database",
    description: "Tables, parts, columnar queries.",
    category: "Database",
    icon: Database,
    slug: "clickhouse",
    color: "from-yellow-400 to-orange-500",
    status: "coming-soon",
  },
  {
    id: "nats",
    name: "NATS",
    tagline: "Messaging system",
    description: "Subjects, JetStream, KV.",
    category: "Streaming",
    icon: Network,
    slug: "natsdotio",
    color: "from-sky-400 to-indigo-600",
    status: "coming-soon",
  },
  {
    id: "sqlite",
    name: "SQLite",
    tagline: "Embedded database",
    description: "File-backed databases.",
    category: "Database",
    icon: Database,
    slug: "sqlite",
    color: "from-blue-400 to-indigo-600",
    status: "coming-soon",
  },
  {
    id: "etcd",
    name: "etcd",
    tagline: "Key-value store",
    description: "Leases, watches, distributed config.",
    category: "Other",
    icon: Boxes,
    slug: "etcd",
    color: "from-lime-400 to-green-600",
    status: "coming-soon",
  },
];

export function getTech(id: string): TechMeta | undefined {
  return TECH_CATALOG.find((t) => t.id === id);
}
