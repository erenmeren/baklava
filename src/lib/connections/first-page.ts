import type { TechId } from "./types";
import { getTech } from "@/lib/tech-catalog";

/**
 * Parse a `/<tech>/<id>/...` workspace path into its tech + connection id.
 * The tech is validated against the catalog, so this is the single source of
 * truth for "which path is a workspace" — no per-tech regex to keep in sync.
 */
export function parseWorkspacePath(
  pathname: string | null | undefined,
): { tech: TechId; id: string } | null {
  const m = pathname?.match(/^\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  const [, seg, id] = m;
  const meta = getTech(seg);
  return meta && meta.kind !== "tool" ? { tech: seg as TechId, id } : null;
}

/** The initial section a workspace tab opens at, per tech. Empty = the
 *  workspace root (overview). */
export const FIRST_PAGE: Record<TechId, string> = {
  docker: "containers",
  postgres: "",
  mysql: "",
  kafka: "",
  sqlserver: "",
  kubernetes: "pods",
  redis: "keys",
  mongo: "databases",
  r2: "",
  minio: "",
  s3: "",
};

export function workspaceHref(tech: TechId, id: string): string {
  const seg = FIRST_PAGE[tech];
  return seg ? `/${tech}/${id}/${seg}` : `/${tech}/${id}`;
}
