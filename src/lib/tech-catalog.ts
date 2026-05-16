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
    color: "from-sky-400 to-blue-600",
    status: "available",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    tagline: "Relational database",
    description: "Run queries, browse schemas and inspect tables.",
    category: "Database",
    color: "from-indigo-400 to-violet-600",
    status: "available",
  },
  {
    id: "kafka",
    name: "Kafka",
    tagline: "Streaming platform",
    description: "Browse topics, partitions and consumer groups.",
    category: "Streaming",
    color: "from-orange-400 to-red-600",
    status: "available",
  },
  {
    id: "redis",
    name: "Redis",
    tagline: "Key-value cache",
    description: "Keys, streams, pub/sub.",
    category: "Cache",
    color: "from-rose-400 to-red-600",
    status: "available",
  },
  {
    id: "mysql",
    name: "MySQL",
    tagline: "Relational database",
    description: "Tables, queries, replication.",
    category: "Database",
    color: "from-cyan-400 to-blue-600",
    status: "available",
  },
  {
    id: "sqlserver",
    name: "SQL Server",
    tagline: "Microsoft relational database",
    description: "Databases, tables, queries.",
    category: "Database",
    color: "from-red-400 to-rose-600",
    status: "available",
  },
  {
    id: "mongo",
    name: "MongoDB",
    tagline: "Document database",
    description: "Collections, documents, aggregations.",
    category: "Database",
    color: "from-emerald-400 to-green-600",
    status: "available",
  },
  {
    id: "rabbit",
    name: "RabbitMQ",
    tagline: "Message broker",
    description: "Queues, exchanges, bindings.",
    category: "Streaming",
    color: "from-amber-400 to-orange-600",
    status: "available",
  },
  {
    id: "elastic",
    name: "Elasticsearch",
    tagline: "Search engine",
    description: "Indices, search, mappings.",
    category: "Search",
    color: "from-teal-400 to-cyan-600",
    status: "available",
  },
  {
    id: "clickhouse",
    name: "ClickHouse",
    tagline: "OLAP database",
    description: "Tables, parts, columnar queries.",
    category: "Database",
    color: "from-yellow-400 to-orange-500",
    status: "available",
  },
  {
    id: "nats",
    name: "NATS",
    tagline: "Messaging system",
    description: "Subjects, JetStream, KV.",
    category: "Streaming",
    color: "from-sky-400 to-indigo-600",
    status: "available",
  },
  {
    id: "sqlite",
    name: "SQLite",
    tagline: "Embedded database",
    description: "File-backed databases.",
    category: "Database",
    color: "from-blue-400 to-indigo-600",
    status: "available",
  },
  {
    id: "etcd",
    name: "etcd",
    tagline: "Key-value store",
    description: "Leases, watches, distributed config.",
    category: "Other",
    color: "from-lime-400 to-green-600",
    status: "available",
  },
];

export function getTech(id: string): TechMeta | undefined {
  return TECH_CATALOG.find((t) => t.id === id);
}

/**
 * Returns the local URL of a tech's brand SVG.
 *
 * All brand icons live under `/public/icons/<id>.svg` so we never depend on
 * an external CDN at runtime. Add a new tech by saving its SVG to that
 * folder using the tech `id` as the filename.
 */
export function techIconUrl(tech: { id: string }): string {
  return `/icons/${tech.id}.svg`;
}
