"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Loader2,
  Search,
  Star,
  Download,
  CheckCircle2,
  ShieldCheck,
  ArrowLeft,
} from "lucide-react";
import { formatBytes } from "@/components/workspace/format";
import { RelativeTime } from "@/components/workspace/relative-time";
import { cn } from "@/lib/utils";

interface HubSearchResult {
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

interface HubTag {
  name: string;
  fullSize: number;
  lastUpdated: string | null;
  digest: string | null;
  architectures: string[];
}

interface PullProgress {
  status?: string;
  id?: string;
  progress?: string;
  progressDetail?: { current?: number; total?: number };
}

interface Props {
  connectionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPullComplete: () => void;
}

type View = "search" | "tags" | "pulling";

export function HubSearchDialog({
  connectionId,
  open,
  onOpenChange,
  onPullComplete,
}: Props) {
  const [view, setView] = useState<View>("search");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HubSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<HubSearchResult | null>(null);
  const [tags, setTags] = useState<HubTag[] | null>(null);
  const [loadingTags, setLoadingTags] = useState(false);

  const [pullingRef, setPullingRef] = useState<string | null>(null);
  const [layers, setLayers] = useState<Record<string, PullProgress>>({});
  const [pullDone, setPullDone] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      sourceRef.current?.close();
      sourceRef.current = null;
      setView("search");
      setSelected(null);
      setTags(null);
      setPullingRef(null);
      setLayers({});
      setPullDone(false);
      setPullError(null);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, []);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/registry/search?q=${encodeURIComponent(q)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setResults(data.results as HubSearchResult[]);
      else toast.error("Search failed", { description: data.error });
    } finally {
      setSearching(false);
    }
  }, [connectionId, query]);

  const openTags = async (r: HubSearchResult) => {
    setSelected(r);
    setView("tags");
    setLoadingTags(true);
    setTags(null);
    try {
      const res = await fetch(
        `/api/docker/${connectionId}/registry/tags?namespace=${encodeURIComponent(r.namespace)}&name=${encodeURIComponent(r.name)}`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setTags(data.tags as HubTag[]);
      else toast.error("Could not load tags", { description: data.error });
    } finally {
      setLoadingTags(false);
    }
  };

  const startPull = (tag: string) => {
    if (!selected) return;
    const ns =
      selected.namespace === "library" || !selected.namespace
        ? ""
        : `${selected.namespace}/`;
    const ref = `${ns}${selected.name}:${tag}`;

    setView("pulling");
    setPullingRef(ref);
    setLayers({});
    setPullDone(false);
    setPullError(null);

    const url = `/api/docker/${connectionId}/images/pull-stream?ref=${encodeURIComponent(ref)}`;
    const es = new EventSource(url);
    sourceRef.current = es;
    es.addEventListener("progress", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as PullProgress;
      const key = data.id || data.status || "_root";
      setLayers((prev) => ({ ...prev, [key]: data }));
    });
    es.addEventListener("done", () => {
      setPullDone(true);
      es.close();
      sourceRef.current = null;
      toast.success("Image pulled", { description: ref });
      onPullComplete();
    });
    es.addEventListener("error", (ev) => {
      const msg =
        (ev as MessageEvent).data &&
        typeof (ev as MessageEvent).data === "string"
          ? (() => {
              try {
                return JSON.parse((ev as MessageEvent).data).message;
              } catch {
                return "Pull failed";
              }
            })()
          : "Pull failed";
      setPullError(msg);
      es.close();
      sourceRef.current = null;
    });
  };

  const layerKeys = Object.keys(layers);
  const totalCurrent = Object.values(layers).reduce(
    (sum, l) => sum + (l.progressDetail?.current ?? 0),
    0
  );
  const totalTotal = Object.values(layers).reduce(
    (sum, l) => sum + (l.progressDetail?.total ?? 0),
    0
  );
  const overallPct =
    totalTotal > 0 ? Math.min(100, (totalCurrent / totalTotal) * 100) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {view !== "search" ? (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setView("search")}
                className="-ml-1.5"
                disabled={view === "pulling" && !pullDone && !pullError}
              >
                <ArrowLeft className="size-4" />
              </Button>
            ) : null}
            {view === "search" && "Search Docker Hub"}
            {view === "tags" && (
              <span className="font-mono text-base">
                {selected?.namespace !== "library" && selected?.namespace
                  ? `${selected.namespace}/`
                  : ""}
                {selected?.name}
              </span>
            )}
            {view === "pulling" && (
              <span className="font-mono text-base">
                pulling <span className="text-brand">{pullingRef}</span>
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {view === "search" &&
              "Search public images on Docker Hub. Pick one to see its tags."}
            {view === "tags" &&
              selected &&
              (selected.description || "No description provided.")}
            {view === "pulling" && "Streaming progress from the Docker daemon."}
          </DialogDescription>
        </DialogHeader>

        {/* SEARCH VIEW */}
        {view === "search" && (
          <div className="flex flex-col min-h-0 gap-3">
            <div className="flex gap-2">
              <Input
                placeholder="postgres, nginx, redis…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search()}
                spellCheck={false}
                autoFocus
              />
              <Button onClick={search} disabled={searching || !query.trim()}>
                {searching ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Search className="size-3.5" />
                )}
                Search
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
              {searching ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : results === null ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Type a query and press Enter.
                </p>
              ) : results.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No images found.
                </p>
              ) : (
                <ul className="grid gap-2">
                  {results.map((r) => (
                    <li
                      key={`${r.namespace}/${r.name}`}
                      className="rounded-lg border border-border/60 hover:border-brand/50 hover:bg-foreground/[0.02] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => openTags(r)}
                        className="text-left w-full p-3 flex flex-col gap-1.5"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm">
                            {r.namespace !== "library" ? `${r.namespace}/` : ""}
                            {r.name}
                          </span>
                          {r.isOfficial ? (
                            <Badge
                              variant="default"
                              className="text-[10px] gap-1 bg-brand-muted text-brand-foreground border-brand/30"
                            >
                              <CheckCircle2 className="size-3" /> official
                            </Badge>
                          ) : null}
                          {!r.isOfficial && r.publisher ? (
                            <Badge
                              variant="secondary"
                              className="text-[10px] gap-1"
                            >
                              <ShieldCheck className="size-3" /> {r.publisher}
                            </Badge>
                          ) : null}
                          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground font-mono">
                            <Star className="size-3" />
                            {r.starCount.toLocaleString()}
                          </span>
                        </div>
                        {r.description ? (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {r.description}
                          </p>
                        ) : null}
                        {r.pullCount > 0 ? (
                          <span className="text-[10px] text-muted-foreground/70 font-mono">
                            {r.pullCount.toLocaleString()} pulls
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* TAGS VIEW */}
        {view === "tags" && (
          <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
            {loadingTags ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : tags === null ? null : tags.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No tags.
              </p>
            ) : (
              <ul className="grid gap-1.5">
                {tags.map((t) => (
                  <li
                    key={t.name}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 hover:border-brand/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm truncate">
                          {t.name}
                        </span>
                        {t.architectures.slice(0, 4).map((a) => (
                          <span
                            key={a}
                            className="text-[10px] font-mono text-muted-foreground/70 px-1 py-0.5 rounded border border-border/60"
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                        {t.fullSize > 0
                          ? formatBytes(t.fullSize)
                          : "size unknown"}
                        {t.lastUpdated ? (
                          <>
                            {" · "}
                            <RelativeTime value={t.lastUpdated} />
                          </>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => startPull(t.name)}
                      className="shrink-0"
                    >
                      <Download className="size-3.5" />
                      Pull
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* PULLING VIEW */}
        {view === "pulling" && (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            <div className="rounded-lg border border-border/60 p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">
                  {pullDone
                    ? "Pull complete"
                    : pullError
                      ? "Pull failed"
                      : `${layerKeys.length} layer${layerKeys.length === 1 ? "" : "s"} active`}
                </span>
                {overallPct != null && !pullDone && !pullError ? (
                  <span className="text-xs font-mono text-muted-foreground">
                    {overallPct.toFixed(0)}%
                  </span>
                ) : null}
              </div>
              <div className="h-1.5 rounded-full bg-foreground/5 overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all",
                    pullError
                      ? "bg-destructive"
                      : pullDone
                        ? "bg-emerald-500"
                        : "bg-brand"
                  )}
                  style={{
                    width: pullDone
                      ? "100%"
                      : overallPct != null
                        ? `${overallPct}%`
                        : "8%",
                  }}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border/60 bg-zinc-950 text-zinc-100 p-3 font-mono text-[11px] leading-relaxed">
              {layerKeys.length === 0 && !pullError ? (
                <span className="text-zinc-400">
                  <Loader2 className="size-3 animate-spin inline mr-1" />
                  Connecting to registry…
                </span>
              ) : null}
              {layerKeys.map((k) => {
                const l = layers[k];
                return (
                  <div key={k} className="flex gap-2">
                    {l.id ? (
                      <span className="text-zinc-500 shrink-0">{l.id}</span>
                    ) : null}
                    <span className="text-zinc-300 shrink-0">{l.status}</span>
                    {l.progress ? (
                      <span className="text-zinc-500 truncate">
                        {l.progress}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              {pullError ? (
                <div className="text-red-400 mt-2">{pullError}</div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              {pullDone || pullError ? (
                <Button onClick={() => onOpenChange(false)}>Close</Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    sourceRef.current?.close();
                    sourceRef.current = null;
                    onOpenChange(false);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
