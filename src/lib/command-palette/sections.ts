import type { TechId } from "@/lib/connections/types";

export interface TechSection {
  label: string;
  /** Route segment after /<tech>/<id>/. Empty string = workspace root. */
  seg: string;
  /** lucide-react icon name. */
  icon: string;
}

export const TECH_SECTIONS: Record<TechId, TechSection[]> = {
  docker: [
    { label: "Containers", seg: "containers", icon: "Box" },
    { label: "Images", seg: "images", icon: "Layers" },
    { label: "Networks", seg: "networks", icon: "Network" },
    { label: "Volumes", seg: "volumes", icon: "HardDrive" },
    { label: "Stacks", seg: "stacks", icon: "Boxes" },
    { label: "Registries", seg: "registries", icon: "Container" },
    { label: "System", seg: "system", icon: "Activity" },
    { label: "Events", seg: "events", icon: "Radio" },
  ],
  postgres: [
    { label: "Databases", seg: "databases", icon: "Database" },
    { label: "Activity", seg: "activity", icon: "Activity" },
    { label: "Locks", seg: "locks", icon: "Lock" },
    { label: "Roles", seg: "roles", icon: "Users" },
    { label: "Extensions", seg: "extensions", icon: "Puzzle" },
    { label: "Diagnostics", seg: "diagnostics", icon: "Stethoscope" },
  ],
  mysql: [
    { label: "Databases", seg: "databases", icon: "Database" },
    { label: "Process list", seg: "processlist", icon: "Activity" },
  ],
  kafka: [
    { label: "Topics", seg: "", icon: "Radio" },
  ],
  sqlserver: [
    { label: "Databases", seg: "databases", icon: "Database" },
    { label: "Activity", seg: "activity", icon: "Activity" },
    { label: "Locks", seg: "locks", icon: "Lock" },
    { label: "Queries", seg: "queries", icon: "ListOrdered" },
    { label: "Query Store", seg: "query-store", icon: "Archive" },
    { label: "Query", seg: "query", icon: "Terminal" },
    { label: "Backup", seg: "backup", icon: "Save" },
    { label: "Indexes", seg: "indexes", icon: "ListTree" },
    { label: "Security", seg: "security", icon: "Shield" },
  ],
  kubernetes: [
    { label: "Pods", seg: "pods", icon: "Box" },
    { label: "Deployments", seg: "deployments", icon: "Layers" },
    { label: "Services", seg: "services", icon: "Network" },
    { label: "ConfigMaps", seg: "configmaps", icon: "FileText" },
    { label: "Secrets", seg: "secrets", icon: "KeyRound" },
    { label: "Namespaces", seg: "namespaces", icon: "Boxes" },
  ],
  redis: [
    { label: "Keys", seg: "keys", icon: "KeyRound" },
    { label: "CLI", seg: "cli", icon: "Terminal" },
    { label: "Pub/Sub", seg: "pubsub", icon: "Radio" },
    { label: "Streams", seg: "streams", icon: "Waves" },
    { label: "Monitor", seg: "monitor", icon: "Activity" },
    { label: "Cluster", seg: "cluster", icon: "Network" },
    { label: "ACL", seg: "acl", icon: "Shield" },
    { label: "Info", seg: "info", icon: "Info" },
  ],
  mongo: [
    { label: "Databases", seg: "databases", icon: "Database" },
    { label: "Current ops", seg: "current-op", icon: "Activity" },
    { label: "Server status", seg: "server-status", icon: "Gauge" },
    { label: "Replica set", seg: "repl-status", icon: "Network" },
  ],
  r2: [
    { label: "Overview", seg: "", icon: "LayoutDashboard" },
    { label: "Buckets", seg: "buckets", icon: "Boxes" },
  ],
  minio: [
    { label: "Overview", seg: "", icon: "LayoutDashboard" },
    { label: "Buckets", seg: "buckets", icon: "Boxes" },
  ],
  s3: [
    { label: "Overview", seg: "", icon: "LayoutDashboard" },
    { label: "Buckets", seg: "buckets", icon: "Boxes" },
  ],
};

export function sectionsFor(tech: TechId): TechSection[] {
  return TECH_SECTIONS[tech] ?? [];
}
