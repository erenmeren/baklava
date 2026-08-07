import type { ObjectProvider, PaletteObject } from "./object-providers";

/**
 * Providers for the techs whose palette objects are connection-scoped rather
 * than database-scoped (see sql-providers.ts for the SQL trio). Each one only
 * surfaces objects that have a real detail route to land on — listing an object
 * the palette can't navigate to would be a dead end.
 *
 * Redis keys and Kubernetes workloads are deliberately absent: their workspaces
 * render list pages with no per-object route and no deep-link search param, so
 * there is nothing to point an href at yet.
 */

/**
 * The palette re-invokes providers on every (debounced) keystroke. The SQL
 * providers refetch each time, which is cheap against a warm pg pool — but a
 * Kafka admin client or a Docker daemon call per keystroke is not. Memoize
 * responses briefly so typing costs one upstream call, not one per character.
 */
const TTL_MS = 10_000;
const cache = new Map<string, { at: number; data: unknown }>();

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;
  try {
    const res = await fetch(url, { cache: "no-store", signal });
    if (!res.ok) return null;
    const data = (await res.json()) as T;
    cache.set(url, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}

/** Case-insensitive substring match over the fields worth searching. */
function matcher(query: string) {
  const q = query.toLowerCase();
  return (...fields: (string | undefined)[]) =>
    fields.some((f) => f?.toLowerCase().includes(q));
}

const LIMIT = 25;

// ─── Docker ──────────────────────────────────────────────────────────────────
// `/api/docker/<id>/containers?all=1` → { containers: ContainerSummary[] }.
// `all=1` so stopped containers are reachable too — that's often exactly what
// you're hunting for. Images/volumes/networks have list pages but no detail
// route, so containers are the only navigable object here.
export const dockerProvider: ObjectProvider = async (id, query, { signal }) => {
  if (query.trim().length < 1) return [];
  const data = await getJson<{
    containers?: Array<{ id: string; name: string; image: string; state: string }>;
  }>(`/api/docker/${id}/containers?all=1`, signal);
  const hit = matcher(query);
  return (data?.containers ?? [])
    .filter((c) => hit(c.name, c.image))
    .slice(0, LIMIT)
    .map((c) => ({
      label: c.name,
      sublabel: `${c.state} · ${c.image}`,
      href: `/docker/${id}/containers/${encodeURIComponent(c.id)}`,
      icon: "Container",
    }));
};

// ─── Kafka ───────────────────────────────────────────────────────────────────
// Topics and consumer groups, fetched together. `/topics` already filters
// internal topics unless `?internal=1`.
export const kafkaProvider: ObjectProvider = async (id, query, { signal }) => {
  if (query.trim().length < 1) return [];
  const [topics, groups] = await Promise.all([
    getJson<{ topics?: Array<{ name: string; partitions: number }> }>(
      `/api/kafka/${id}/topics`,
      signal,
    ),
    getJson<{ groups?: Array<{ groupId: string; state?: string }> }>(
      `/api/kafka/${id}/consumer-groups`,
      signal,
    ),
  ]);
  const hit = matcher(query);
  const out: PaletteObject[] = [];
  for (const t of topics?.topics ?? []) {
    if (!hit(t.name)) continue;
    out.push({
      label: t.name,
      sublabel: `topic · ${t.partitions} partitions`,
      href: `/kafka/${id}/topics/${encodeURIComponent(t.name)}`,
      icon: "Layers",
    });
  }
  for (const g of groups?.groups ?? []) {
    if (!hit(g.groupId)) continue;
    out.push({
      label: g.groupId,
      sublabel: g.state ? `consumer group · ${g.state}` : "consumer group",
      href: `/kafka/${id}/consumer-groups/${encodeURIComponent(g.groupId)}`,
      icon: "Users",
    });
  }
  return out.slice(0, LIMIT);
};

// ─── MongoDB ─────────────────────────────────────────────────────────────────
// Databases are always searchable; collections are added once a database is in
// the path (`/mongo/<id>/databases/<db>`), matching how the SQL providers scope
// themselves. Collection pages live at `databases/<db>/<coll>` — no `tables`
// segment, unlike the SQL workspaces.
export const mongoProvider: ObjectProvider = async (id, query, { pathname, signal }) => {
  if (query.trim().length < 1) return [];
  const m = pathname.match(/^\/mongo\/[^/]+\/databases\/([^/]+)/);
  const db = m ? decodeURIComponent(m[1]) : null;
  const hit = matcher(query);
  const out: PaletteObject[] = [];

  if (db) {
    const data = await getJson<{ collections?: Array<{ name: string; type: string }> }>(
      `/api/mongo/${id}/databases/${encodeURIComponent(db)}/collections`,
      signal,
    );
    for (const c of data?.collections ?? []) {
      if (!hit(c.name)) continue;
      out.push({
        label: c.name,
        sublabel: `${db} · ${c.type}`,
        href: `/mongo/${id}/databases/${encodeURIComponent(db)}/${encodeURIComponent(c.name)}`,
        icon: "Table2",
      });
    }
  }

  const dbs = await getJson<{ databases?: Array<{ name: string }> }>(
    `/api/mongo/${id}/databases`,
    signal,
  );
  for (const d of dbs?.databases ?? []) {
    if (!hit(d.name)) continue;
    out.push({
      label: d.name,
      sublabel: "database",
      href: `/mongo/${id}/databases/${encodeURIComponent(d.name)}`,
      icon: "Database",
    });
  }
  return out.slice(0, LIMIT);
};

// ─── Qdrant ──────────────────────────────────────────────────────────────────
export const qdrantProvider: ObjectProvider = async (id, query, { signal }) => {
  if (query.trim().length < 1) return [];
  const data = await getJson<{
    collections?: Array<{ name: string; status: string; pointsCount: number }>;
  }>(`/api/qdrant/${id}/collections`, signal);
  const hit = matcher(query);
  return (data?.collections ?? [])
    .filter((c) => hit(c.name))
    .slice(0, LIMIT)
    .map((c) => ({
      label: c.name,
      sublabel: `${c.status} · ${c.pointsCount} points`,
      href: `/qdrant/${id}/collections/${encodeURIComponent(c.name)}`,
      icon: "Database",
    }));
};

// ─── Object storage (S3 · R2 · MinIO) ────────────────────────────────────────
// All three share `blobHandlers`, so one factory covers them: the route shape
// and the workspace path differ only by tech id.
export function blobProvider(tech: "s3" | "r2" | "minio"): ObjectProvider {
  return async (id, query, { signal }) => {
    if (query.trim().length < 1) return [];
    const data = await getJson<{ buckets?: Array<{ name: string }> }>(
      `/api/${tech}/${id}/buckets`,
      signal,
    );
    const hit = matcher(query);
    return (data?.buckets ?? [])
      .filter((b) => hit(b.name))
      .slice(0, LIMIT)
      .map((b) => ({
        label: b.name,
        sublabel: "bucket",
        href: `/${tech}/${id}/buckets/${encodeURIComponent(b.name)}`,
        icon: "Boxes",
      }));
  };
}
