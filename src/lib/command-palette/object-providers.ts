import type { TechId } from "@/lib/connections/types";

export interface PaletteObject {
  label: string;
  sublabel?: string;
  href: string;
  icon?: string;
}

export type ObjectProvider = (
  connectionId: string,
  query: string,
  ctx: { pathname: string },
) => Promise<PaletteObject[]>;

/** Pull the active database from a /<tech>/<id>/databases/<db>/... path. */
function dbFromPath(tech: string, pathname: string): string | null {
  const m = pathname.match(new RegExp(`^/${tech}/[^/]+/databases/([^/]+)`));
  if (!m) return null;
  const db = decodeURIComponent(m[1]);
  // `_` is the "no database" placeholder some workspaces use in the URL.
  return db && db !== "_" ? db : null;
}

// ─── Postgres ────────────────────────────────────────────────────────────────
// Mirrors src/components/postgres/command-palette.tsx: fetches the active
// database's relations and links each to its table page. (The endpoint returns
// extra fields — kind/columns/isSystem — which we don't need here.)
const postgresProvider: ObjectProvider = async (id, query, { pathname }) => {
  const db = dbFromPath("postgres", pathname);
  if (!db || query.trim().length < 1) return [];
  try {
    const res = await fetch(
      `/api/postgres/${id}/databases/${encodeURIComponent(db)}/all-relations`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      relations?: Array<{ schema: string; name: string; isSystem?: boolean }>;
    };
    const q = query.toLowerCase();
    return (data.relations ?? [])
      .filter((r) => !r.isSystem && r.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((r) => ({
        label: r.name,
        sublabel: `${db}.${r.schema}`,
        href: `/postgres/${id}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(r.schema)}/tables/${encodeURIComponent(r.name)}`,
        icon: "Table2",
      }));
  } catch {
    return [];
  }
};

export const OBJECT_PROVIDERS: Partial<Record<TechId, ObjectProvider>> = {
  postgres: postgresProvider,
};
