import type { TechId } from "./types";
import { getTech } from "@/lib/tech-catalog";
import { TECH_META } from "@/techs/meta-registry";

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
export const FIRST_PAGE: Record<TechId, string> = Object.fromEntries(
  (Object.entries(TECH_META) as [TechId, (typeof TECH_META)[TechId]][]).map(
    ([id, meta]) => [id, meta.firstPage],
  ),
) as Record<TechId, string>;

export function workspaceHref(tech: TechId, id: string): string {
  const seg = FIRST_PAGE[tech];
  return seg ? `/${tech}/${id}/${seg}` : `/${tech}/${id}`;
}
