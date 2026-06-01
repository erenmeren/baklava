export type TechCategory =
  | "Runtime"
  | "Database"
  | "Streaming"
  | "Orchestration"
  | "Cache"
  | "Storage";

export const TECH_CATEGORIES = [
  "All",
  "Runtime",
  "Database",
  "Streaming",
  "Orchestration",
  "Cache",
  "Storage",
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
    id: "mysql",
    name: "MySQL",
    tagline: "Relational database",
    description:
      "phpMyAdmin-style: databases, tables, query editor, row CRUD, indexes and live process list.",
    category: "Database",
    color: "from-amber-400 to-orange-600",
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
    id: "kubernetes",
    name: "Kubernetes",
    tagline: "Container orchestrator",
    description:
      "k9s-inspired terminal-style browser for pods, deployments, services and more.",
    category: "Orchestration",
    color: "from-cyan-400 to-blue-700",
    status: "available",
  },
  {
    id: "redis",
    name: "Redis",
    tagline: "In-memory data store",
    description:
      "RedisInsight-style browser: typed key viewer, CLI, pub/sub, streams, MONITOR, cluster topology.",
    category: "Cache",
    color: "from-rose-400 to-red-700",
    status: "available",
  },
  {
    id: "mongo",
    name: "MongoDB",
    tagline: "Document database",
    description:
      "Compass-style: databases, collections, document browser with EJSON filter, aggregation pipeline, indexes.",
    category: "Database",
    color: "from-emerald-400 to-green-700",
    status: "available",
  },
  {
    id: "r2",
    name: "Cloudflare R2",
    tagline: "Object storage",
    description:
      "S3-style object browser: buckets, prefix navigation, upload/download, presigned links, CORS and lifecycle.",
    category: "Storage",
    color: "from-orange-400 to-amber-500",
    status: "available",
  },
  {
    id: "minio",
    name: "MinIO",
    tagline: "S3-compatible object storage",
    description: "Self-hosted S3 object browser: buckets, prefix navigation, upload/download, presigned links, CORS and lifecycle.",
    category: "Storage",
    color: "from-red-400 to-rose-600",
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
