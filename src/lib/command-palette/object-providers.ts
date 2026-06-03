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

// ─── MySQL ─────────────────────────────────────────────────────────────────
// The original palette (src/app/mysql/[connectionId]/command-palette-host.tsx)
// loads the whole database list, then lazily fetches tables across every db.
// In the global palette we only have the pathname, so we scope to the active
// database (`/mysql/<id>/databases/<db>`) and list its tables — a faithful
// subset of the per-tech palette. `/api/mysql/<id>/databases/<db>` returns
// `{ tables: [{ name, kind }] }`; href matches the per-tech palette.
const mysqlProvider: ObjectProvider = async (id, query, { pathname }) => {
  const db = dbFromPath("mysql", pathname);
  if (!db || query.trim().length < 1) return [];
  try {
    const res = await fetch(
      `/api/mysql/${id}/databases/${encodeURIComponent(db)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      tables?: Array<{ name: string; kind: "table" | "view" }>;
    };
    const q = query.toLowerCase();
    return (data.tables ?? [])
      .filter((t) => t.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((t) => ({
        label: t.name,
        sublabel: db,
        href: `/mysql/${id}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(t.name)}`,
        icon: t.kind === "view" ? "View" : "Table2",
      }));
  } catch {
    return [];
  }
};

// ─── SQL Server ──────────────────────────────────────────────────────────────
// Mirrors src/app/sqlserver/[connectionId]/command-palette-host.tsx:
// `/api/sqlserver/<id>/databases/<db>/objects` → `{ objects: [{schema,name,kind}] }`.
// Tables link to the table page; everything else (views, procs, functions) to
// the module page — same branching the per-tech palette uses. The per-tech
// palette searched the connection's default database; the global palette scopes
// to the database in the path (`/sqlserver/<id>/databases/<db>`).
const sqlserverProvider: ObjectProvider = async (id, query, { pathname }) => {
  const db = dbFromPath("sqlserver", pathname);
  if (!db || query.trim().length < 1) return [];
  try {
    const res = await fetch(
      `/api/sqlserver/${id}/databases/${encodeURIComponent(db)}/objects`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      objects?: Array<{ schema: string; name: string; kind: string }>;
    };
    const q = query.toLowerCase();
    return (data.objects ?? [])
      .filter((o) => `${o.schema}.${o.name}`.toLowerCase().includes(q))
      .slice(0, 25)
      .map((o) => ({
        label: o.name,
        sublabel: `${o.schema} · ${o.kind}`,
        href:
          o.kind === "table"
            ? `/sqlserver/${id}/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(o.schema)}/${encodeURIComponent(o.name)}`
            : `/sqlserver/${id}/databases/${encodeURIComponent(db)}/modules/${encodeURIComponent(o.schema)}/${encodeURIComponent(o.name)}`,
        icon:
          o.kind === "table"
            ? "Table2"
            : o.kind === "view"
              ? "View"
              : "FileCode2",
      }));
  } catch {
    return [];
  }
};

export const OBJECT_PROVIDERS: Partial<Record<TechId, ObjectProvider>> = {
  postgres: postgresProvider,
  mysql: mysqlProvider,
  sqlserver: sqlserverProvider,
};
