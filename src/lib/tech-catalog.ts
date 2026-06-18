export type TechCategory =
  | "Runtime"
  | "Database"
  | "Vector"
  | "Streaming"
  | "Orchestration"
  | "Cache"
  | "Storage"
  | "Testing";

export const TECH_CATEGORIES = [
  "All",
  "Runtime",
  "Database",
  "Vector",
  "Streaming",
  "Orchestration",
  "Cache",
  "Storage",
  "Testing",
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
  /** "tool" entries are standalone tools (no connection record); absent means "connection" */
  kind?: "connection" | "tool";
}

import { TECH_META_LIST } from "@/techs/meta-registry";

/** Standalone tools (no connection record). Hand-maintained — not TechModules. */
const TOOL_ENTRIES: TechMeta[] = [
  {
    id: "loadtest",
    name: "Load Testing",
    tagline: "k6 load tests",
    description: "Define, run, and track HTTP load tests against any REST API with k6.",
    category: "Testing",
    color: "from-amber-400 to-orange-600",
    status: "available",
    kind: "tool",
  },
];

export const TECH_CATALOG: TechMeta[] = [
  ...TECH_META_LIST.map((m) => m.catalog),
  ...TOOL_ENTRIES,
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
