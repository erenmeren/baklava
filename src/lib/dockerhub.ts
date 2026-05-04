import "server-only";

export interface HubSearchResult {
  name: string;
  namespace: string;
  description: string;
  pullCount: number;
  starCount: number;
  isOfficial: boolean;
  isAutomated: boolean;
  publisher: string | null;
  updatedAt: string | null;
}

interface HubSearchResponse {
  results: {
    repo_name?: string;
    repo_owner?: string | null;
    short_description?: string | null;
    pull_count?: number;
    star_count?: number;
    is_official?: boolean;
    is_automated?: boolean;
  }[];
}

function splitRepoName(repoName: string): { namespace: string; name: string } {
  const idx = repoName.indexOf("/");
  if (idx < 0) return { namespace: "library", name: repoName };
  return {
    namespace: repoName.slice(0, idx),
    name: repoName.slice(idx + 1),
  };
}

const UA = "baklava/0.1 (+https://github.com/baklava-app)";

export async function searchDockerHub(
  query: string,
  page = 1,
  pageSize = 25
): Promise<HubSearchResult[]> {
  const url = new URL(
    "https://hub.docker.com/v2/search/repositories/"
  );
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));

  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Docker Hub search failed: ${res.status}`);
  const data = (await res.json()) as HubSearchResponse;
  return (data.results ?? [])
    .filter((r): r is HubSearchResponse["results"][number] & { repo_name: string } =>
      Boolean(r.repo_name)
    )
    .map((r) => {
      const { namespace, name } = splitRepoName(r.repo_name);
      return {
        name,
        namespace,
        description: r.short_description ?? "",
        pullCount: r.pull_count ?? 0,
        starCount: r.star_count ?? 0,
        isOfficial: Boolean(r.is_official),
        isAutomated: Boolean(r.is_automated),
        publisher: r.repo_owner || null,
        updatedAt: null,
      };
    });
}

export interface HubTag {
  name: string;
  fullSize: number;
  lastUpdated: string | null;
  digest: string | null;
  architectures: string[];
}

interface HubTagsResponse {
  results: {
    name: string;
    full_size?: number;
    last_updated?: string | null;
    digest?: string | null;
    images?: { architecture?: string; digest?: string | null }[];
  }[];
}

export async function listTags(
  namespace: string,
  repository: string,
  pageSize = 25
): Promise<HubTag[]> {
  const ns = namespace || "library";
  const url = new URL(
    `https://hub.docker.com/v2/repositories/${encodeURIComponent(ns)}/${encodeURIComponent(repository)}/tags/`
  );
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("ordering", "last_updated");
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Docker Hub tags failed: ${res.status}`);
  const data = (await res.json()) as HubTagsResponse;
  return (data.results ?? []).map((t) => ({
    name: t.name,
    fullSize: t.full_size ?? 0,
    lastUpdated: t.last_updated ?? null,
    digest: t.digest ?? null,
    architectures: Array.from(
      new Set(
        (t.images ?? [])
          .map((i) => i.architecture)
          .filter((a): a is string => Boolean(a))
      )
    ),
  }));
}

export function buildPullRef(
  namespace: string,
  name: string,
  tag = "latest"
): string {
  // library/postgres → postgres
  // bitnami/postgres → bitnami/postgres
  const ns = namespace === "library" || !namespace ? "" : `${namespace}/`;
  return `${ns}${name}:${tag}`;
}
