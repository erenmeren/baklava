import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { SupabaseConfig } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Client builder — wraps `fetch` with an 8s AbortController so a hung Supabase
// host can't pin the request indefinitely (the SDK has no native timeout).
// We deliberately disable session persistence: every call here is a one-shot
// admin operation, and the SDK's auto-refresh / local-storage paths would
// trip up in a server-side Node context anyway.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 8000;

function timedFetch(timeoutMs = DEFAULT_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const upstream = init?.signal;
    if (upstream) {
      if (upstream.aborted) ctrl.abort();
      else
        upstream.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    return fetch(input, { ...init, signal: ctrl.signal }).finally(() =>
      clearTimeout(timer)
    );
  };
}

function buildClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: timedFetch() },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public driver API
// ─────────────────────────────────────────────────────────────────────────────

export interface SupabaseProbeResult {
  url: string;
  totalUsers: number | null;
}

export async function probeSupabase(
  config: SupabaseConfig
): Promise<SupabaseProbeResult> {
  const client = buildClient(config);
  const { data, error } = await client.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) throw new Error(error.message);
  const total =
    (data as unknown as { total?: number }).total ?? data.users.length;
  return { url: config.url, totalUsers: total };
}

export interface SupabaseBucket {
  id: string;
  name: string;
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[] | null;
  createdAt: string;
  updatedAt: string;
}

function mapBucket(b: {
  id: string;
  name: string;
  public: boolean;
  file_size_limit?: number | null;
  allowed_mime_types?: string[] | null;
  created_at: string;
  updated_at: string;
}): SupabaseBucket {
  return {
    id: b.id,
    name: b.name,
    public: b.public,
    fileSizeLimit: b.file_size_limit ?? null,
    allowedMimeTypes: b.allowed_mime_types ?? null,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
  };
}

export async function listBuckets(
  config: SupabaseConfig
): Promise<SupabaseBucket[]> {
  const client = buildClient(config);
  const { data, error } = await client.storage.listBuckets();
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapBucket).sort((a, b) => a.name.localeCompare(b.name));
}

export interface AuthUserSummary {
  id: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  providers: string[];
}

export interface AuthUsersPage {
  users: AuthUserSummary[];
  page: number;
  perPage: number;
  total: number | null;
  nextPage: number | null;
  lastPage: number | null;
}

export async function listAuthUsers(
  config: SupabaseConfig,
  page = 1,
  perPage = 50
): Promise<AuthUsersPage> {
  const client = buildClient(config);
  const { data, error } = await client.auth.admin.listUsers({ page, perPage });
  if (error) throw new Error(error.message);
  const meta = data as unknown as {
    total?: number;
    nextPage?: number | null;
    lastPage?: number;
  };
  const users: AuthUserSummary[] = data.users.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    phone: u.phone ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    emailConfirmedAt: u.email_confirmed_at ?? null,
    providers: (u.identities ?? [])
      .map((i) => i.provider)
      .filter((v, i, arr) => arr.indexOf(v) === i),
  }));
  return {
    users,
    page,
    perPage,
    total: meta.total ?? null,
    nextPage: meta.nextPage ?? null,
    lastPage: meta.lastPage ?? null,
  };
}

export interface BucketEntry {
  name: string;
  isFolder: boolean;
  size: number | null;
  mimeType: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

export async function listBucketFiles(
  config: SupabaseConfig,
  bucket: string,
  prefix = ""
): Promise<BucketEntry[]> {
  const client = buildClient(config);
  const { data, error } = await client.storage
    .from(bucket)
    .list(prefix, { limit: 200, sortBy: { column: "name", order: "asc" } });
  if (error) throw new Error(error.message);
  // Supabase's list() returns folders as entries with `id === null` and `metadata === null`.
  return (data ?? []).map((entry) => {
    const isFolder = entry.id === null;
    const meta = entry.metadata as
      | { size?: number; mimetype?: string }
      | null
      | undefined;
    return {
      name: entry.name,
      isFolder,
      size: !isFolder ? meta?.size ?? null : null,
      mimeType: !isFolder ? meta?.mimetype ?? null : null,
      updatedAt: entry.updated_at,
      createdAt: entry.created_at,
    } satisfies BucketEntry;
  });
}

export interface EdgeFunctionsResult {
  enabled: boolean;
  note?: string;
  functions: {
    name: string;
    status: string;
    version: number | null;
    createdAt: string | null;
  }[];
}

/**
 * Edge function listing requires the Supabase Management API (and a personal
 * access token), not the project-scoped service_role key — so the JS SDK has
 * no first-class enumeration call. We try a best-effort health probe at
 * `${url}/functions/v1/` and otherwise return a friendly "not available"
 * payload that the UI surfaces as an explanation card.
 */
export async function listEdgeFunctions(
  config: SupabaseConfig
): Promise<EdgeFunctionsResult> {
  const note =
    "Edge function listing requires the Supabase Management API + a personal access token, not the service_role key.";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    const res = await fetch(`${config.url.replace(/\/$/, "")}/functions/v1/`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.serviceRoleKey}`,
        apikey: config.serviceRoleKey,
      },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    // Any non-404 response means the functions runtime is at least reachable.
    // We still can't enumerate without the Management API, so report enabled=false.
    if (res.status === 404) {
      return { enabled: false, note, functions: [] };
    }
    return { enabled: false, note, functions: [] };
  } catch {
    return { enabled: false, note, functions: [] };
  }
}

export interface SupabaseOverview {
  url: string;
  projectRef: string | null;
  totalUsers: number | null;
  buckets: SupabaseBucket[];
  recentUsers: AuthUserSummary[];
  edgeFunctions: EdgeFunctionsResult;
  hasDatabaseUrl: boolean;
}

function deriveProjectRef(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const [ref] = host.split(".");
    return ref || null;
  } catch {
    return null;
  }
}

export async function getSupabaseOverview(
  config: SupabaseConfig
): Promise<SupabaseOverview> {
  const client = buildClient(config);

  // Pull a small first page so we get pagination metadata (total) AND the
  // freshest users for the "recent signups" card in one round-trip.
  const [usersResult, bucketsResult, edgeFunctions] = await Promise.all([
    client.auth.admin
      .listUsers({ page: 1, perPage: 5 })
      .catch((err) => ({ data: null, error: err as Error })),
    client.storage
      .listBuckets()
      .catch((err) => ({ data: null, error: err as Error })),
    listEdgeFunctions(config),
  ]);

  let totalUsers: number | null = null;
  let recentUsers: AuthUserSummary[] = [];
  if (
    "data" in usersResult &&
    usersResult.data &&
    !("error" in usersResult && usersResult.error)
  ) {
    const meta = usersResult.data as unknown as { total?: number };
    totalUsers = meta.total ?? usersResult.data.users.length;
    recentUsers = [...usersResult.data.users]
      .sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        return tb - ta;
      })
      .slice(0, 5)
      .map((u) => ({
        id: u.id,
        email: u.email ?? null,
        phone: u.phone ?? null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        emailConfirmedAt: u.email_confirmed_at ?? null,
        providers: (u.identities ?? [])
          .map((i) => i.provider)
          .filter((v, i, arr) => arr.indexOf(v) === i),
      }));
  } else if ("error" in usersResult && usersResult.error) {
    // surface as a thrown error — the overview API will translate via formatError
    throw new Error(
      (usersResult.error as Error).message || "Failed to list auth users"
    );
  }

  let buckets: SupabaseBucket[] = [];
  if ("data" in bucketsResult && bucketsResult.data) {
    buckets = bucketsResult.data
      .map(mapBucket)
      .sort((a, b) => a.name.localeCompare(b.name));
  } else if ("error" in bucketsResult && bucketsResult.error) {
    throw new Error(
      (bucketsResult.error as Error).message || "Failed to list buckets"
    );
  }

  return {
    url: config.url,
    projectRef: deriveProjectRef(config.url),
    totalUsers,
    buckets,
    recentUsers,
    edgeFunctions,
    hasDatabaseUrl: Boolean(config.databaseUrl),
  };
}
