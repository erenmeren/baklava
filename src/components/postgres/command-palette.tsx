"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  Box,
  Clock,
  Columns3,
  Database,
  Search,
  Table as TableIcon,
  View,
  X,
} from "lucide-react";
import {
  loadRecentQueries,
  subscribeRecentQueries,
  type RecentQuery,
} from "@/lib/postgres/recent-queries";

interface Relation {
  schema: string;
  name: string;
  kind: "table" | "view" | "matview" | "foreign";
  columns: string[];
  isSystem: boolean;
}

interface RelationsResponse {
  relations: Relation[];
}

interface Props {
  connectionId: string;
  /** Database to search by default. */
  currentDatabase: string;
  /** All databases on this connection (for the cross-DB widen mode). */
  allDatabases: string[];
  /** External control: parent decides when to open the palette. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = "objects" | "recent";

interface FlatResult {
  kind: "table" | "view" | "matview" | "foreign" | "column" | "recent";
  /** Display label */
  label: string;
  /** Secondary text on the right (dimmed) */
  meta?: string;
  /** Tertiary text under label */
  sub?: string;
  /** Final navigation URL or action descriptor */
  href?: string;
  /** Recent-query payload for re-run links */
  recent?: RecentQuery;
  /** Score (higher = better match) */
  score: number;
}

// ─── tiny fuzzy matcher ──────────────────────────────────────────────────
// Score = number of consecutive matched runs * 4 + match coverage * 2
// + bonus when the match starts at a word boundary. Good enough for a
// few-thousand-entry palette; no dep needed.
function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 1;
  const H = haystack.toLowerCase();
  const N = needle.toLowerCase();
  if (H === N) return 1000;
  if (H.startsWith(N)) return 500;
  if (H.includes(N)) return 200 + (50 - Math.min(50, H.indexOf(N)));

  let hi = 0;
  let ni = 0;
  let score = 0;
  let lastMatchedHi = -2;
  let runLen = 0;
  while (hi < H.length && ni < N.length) {
    if (H[hi] === N[ni]) {
      runLen = hi === lastMatchedHi + 1 ? runLen + 1 : 1;
      score += 1 + runLen * 2;
      if (hi === 0 || /[^a-z0-9]/.test(H[hi - 1])) score += 4;
      lastMatchedHi = hi;
      ni += 1;
    }
    hi += 1;
  }
  if (ni < N.length) return 0;
  // coverage bonus
  score += Math.max(0, 20 - (H.length - N.length));
  return score;
}

export function CommandPalette({
  connectionId,
  currentDatabase,
  allDatabases,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("objects");
  const [scope, setScope] = useState<"current" | "all">("current");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [byDb, setByDb] = useState<Record<string, Relation[]>>({});
  const [loadingDbs, setLoadingDbs] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<RecentQuery[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    setMode("objects");
    setScope("current");
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  // Subscribe to recent-queries
  useEffect(() => {
    setRecent(loadRecentQueries(connectionId));
    const off = subscribeRecentQueries(connectionId, () =>
      setRecent(loadRecentQueries(connectionId)),
    );
    return off;
  }, [connectionId]);

  // Lazy-fetch relations for the active scope
  const dbsToLoad = useMemo(
    () => (scope === "current" ? [currentDatabase] : allDatabases),
    [scope, currentDatabase, allDatabases],
  );
  useEffect(() => {
    if (!open || mode !== "objects") return;
    for (const db of dbsToLoad) {
      if (byDb[db] || loadingDbs.has(db)) continue;
      setLoadingDbs((s) => new Set(s).add(db));
      void fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(db)}/all-relations`,
        { cache: "no-store" },
      )
        .then(async (res) => {
          if (!res.ok) throw new Error("failed");
          return (await res.json()) as RelationsResponse;
        })
        .then((data) => {
          setByDb((m) => ({ ...m, [db]: data.relations }));
        })
        .catch(() => {
          // leave the cache empty; the modal still works for other DBs
        })
        .finally(() => {
          setLoadingDbs((s) => {
            const next = new Set(s);
            next.delete(db);
            return next;
          });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, dbsToLoad.join(","), connectionId]);

  // Build the flat result list
  const results: FlatResult[] = useMemo(() => {
    const q = query.trim();
    if (mode === "recent") {
      const out = recent
        .map<FlatResult>((r) => ({
          kind: "recent",
          label: r.sql.split("\n")[0].slice(0, 120),
          meta: `${r.database} · ${new Date(r.at).toLocaleString()}`,
          sub:
            r.durationMs != null
              ? `${r.durationMs}ms · ${r.rowCount ?? 0} rows${r.ok ? "" : " · failed"}`
              : undefined,
          recent: r,
          href: `/postgres/${connectionId}/databases/${encodeURIComponent(r.database)}/query?prefill=${encodeURIComponent(r.sql)}`,
          score: q ? fuzzyScore(r.sql, q) : 1,
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);
      return out.slice(0, 50);
    }

    const out: FlatResult[] = [];
    for (const db of dbsToLoad) {
      const rels = byDb[db];
      if (!rels) continue;
      for (const r of rels) {
        if (r.isSystem) continue;
        const fqn = `${r.schema}.${r.name}`;
        const relScore = q ? fuzzyScore(fqn, q) : 1;
        if (relScore > 0) {
          out.push({
            kind: r.kind,
            label: r.name,
            meta:
              scope === "all"
                ? `${db} · ${r.schema}`
                : r.schema,
            sub:
              r.columns.length > 0
                ? `${r.columns.length} column${r.columns.length === 1 ? "" : "s"}`
                : undefined,
            href: `/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(r.schema)}/tables/${encodeURIComponent(r.name)}`,
            score: relScore + 50, // tables outrank columns
          });
        }
        // Columns
        if (q) {
          for (const col of r.columns) {
            const colScore = fuzzyScore(col, q);
            if (colScore > 100) {
              out.push({
                kind: "column",
                label: col,
                meta:
                  scope === "all"
                    ? `${db} · ${r.schema}.${r.name}`
                    : `${r.schema}.${r.name}`,
                href: `/postgres/${connectionId}/databases/${encodeURIComponent(db)}/schemas/${encodeURIComponent(r.schema)}/tables/${encodeURIComponent(r.name)}?col=${encodeURIComponent(col)}`,
                score: colScore,
              });
            }
          }
        }
      }
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 50);
  }, [query, mode, recent, byDb, dbsToLoad, scope, connectionId]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, mode, scope]);

  const choose = useCallback(
    (r: FlatResult) => {
      if (r.href) {
        router.push(r.href);
        onOpenChange(false);
      }
    },
    [router, onOpenChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = results[selectedIndex];
        if (r) choose(r);
      } else if (e.key === "Tab") {
        e.preventDefault();
        setMode((m) => (m === "objects" ? "recent" : "objects"));
      }
    },
    [results, selectedIndex, choose],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        {/* Header: input + mode tabs */}
        <div className="relative border-b border-border/60 flex items-stretch">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              mode === "objects"
                ? scope === "current"
                  ? `Find a table or column in ${currentDatabase}…`
                  : "Find a table or column across all databases…"
                : "Search your recent queries…"
            }
            className="flex-1 h-12 pl-12 pr-3 bg-transparent text-base outline-none"
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 bg-muted/30 text-[10px] font-mono uppercase tracking-wider">
          <div className="inline-flex items-center gap-1">
            <ModeTab active={mode === "objects"} onClick={() => setMode("objects")}>
              Objects
            </ModeTab>
            <ModeTab active={mode === "recent"} onClick={() => setMode("recent")}>
              Recent queries · {recent.length}
            </ModeTab>
          </div>
          {mode === "objects" && allDatabases.length > 1 ? (
            <div className="inline-flex items-center gap-1">
              <ModeTab
                active={scope === "current"}
                onClick={() => setScope("current")}
              >
                {currentDatabase}
              </ModeTab>
              <ModeTab
                active={scope === "all"}
                onClick={() => setScope("all")}
              >
                all DBs
              </ModeTab>
            </div>
          ) : null}
        </div>

        {/* Results */}
        <ul
          className="max-h-[60vh] overflow-y-auto py-1"
          onMouseMove={() => {
            /* prevents flicker when scrolling fast */
          }}
        >
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              {mode === "objects" && Object.keys(byDb).length === 0
                ? "Loading schema…"
                : "No matches."}
            </li>
          ) : (
            results.map((r, i) => (
              <li key={`${r.kind}-${i}-${r.label}`}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={cn(
                    "group/row w-full flex items-baseline gap-3 px-4 py-2 text-left transition-colors",
                    selectedIndex === i
                      ? "bg-brand/10 text-foreground"
                      : "hover:bg-muted/40",
                  )}
                >
                  <KindIcon kind={r.kind} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm truncate">
                      {r.label}
                    </div>
                    {r.sub ? (
                      <div className="font-mono text-[10px] text-muted-foreground truncate">
                        {r.sub}
                      </div>
                    ) : null}
                  </div>
                  {r.meta ? (
                    <span className="font-mono text-[10px] text-muted-foreground/70 truncate max-w-[40%]">
                      {r.meta}
                    </span>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Footer hint */}
        <div className="border-t border-border/60 px-4 py-1.5 text-[10px] font-mono text-muted-foreground flex items-center justify-between">
          <span>
            ↑/↓ to navigate · enter to open · tab to switch mode · esc to
            close
          </span>
          {loadingDbs.size > 0 ? (
            <span className="text-muted-foreground/70">
              loading {loadingDbs.size} db{loadingDbs.size === 1 ? "" : "s"}…
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-0.5 rounded transition-colors",
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function KindIcon({ kind }: { kind: FlatResult["kind"] }) {
  const cls = "size-3.5 shrink-0 text-muted-foreground translate-y-[1px]";
  switch (kind) {
    case "table":
      return <TableIcon className={cls} />;
    case "view":
    case "matview":
      return <View className={cls} />;
    case "foreign":
      return <Database className={cls} />;
    case "column":
      return <Columns3 className={cls} />;
    case "recent":
      return <Clock className={cls} />;
    default:
      return <Box className={cls} />;
  }
}
