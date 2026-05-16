"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { formatBytes } from "@/components/workspace/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Copy,
  Loader2,
  RefreshCcw,
  Search as SearchIcon,
  Trash2,
} from "lucide-react";

type Health = "green" | "yellow" | "red" | "unknown";

interface IndexHeader {
  name: string;
  health: Health;
  docs: number;
  deletedDocs: number;
  sizeBytes: number;
  primarySizeBytes: number;
  primaries: number;
  replicas: number;
  refreshInterval: string;
  system: boolean;
  aliases: string[];
}

interface ShardRow {
  shard: string;
  prirep: "p" | "r" | string;
  state: string;
  docs: number;
  store: number;
  node: string;
}

interface IndexDetail {
  index: IndexHeader;
  mappings: Record<string, unknown>;
  settings: Record<string, unknown>;
  shards: ShardRow[];
}

interface ElasticHit {
  _id: string;
  _score: number | null;
  _source: unknown;
}

interface SearchResult {
  total: number;
  hits: ElasticHit[];
}

interface Props {
  connectionId: string;
  name: string;
}

const HEALTH_DOT: Record<Health, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
  unknown: "bg-muted-foreground/40",
};

const HEALTH_TEXT: Record<Health, string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  yellow: "text-amber-700 dark:text-amber-300",
  red: "text-red-700 dark:text-red-300",
  unknown: "text-muted-foreground",
};

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

// Noise we hide from the Settings tab body and surface as footer metadata.
const SETTINGS_METADATA_KEYS = new Set([
  "creation_date",
  "uuid",
  "version",
  "provided_name",
]);

function splitSettings(settings: Record<string, unknown>): {
  display: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const index = (settings.index ?? {}) as Record<string, unknown>;
  const display: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(index)) {
    if (SETTINGS_METADATA_KEYS.has(k)) metadata[k] = v;
    else display[k] = v;
  }
  return { display: { index: display }, metadata };
}

export function IndexDetailClient({ connectionId, name }: Props) {
  const router = useRouter();
  const base = `/api/elastic/${connectionId}/indices/${encodeURIComponent(name)}`;

  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState<IndexDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // search tab
  const [searchQuery, setSearchQuery] = useState("");
  const [searchSize, setSearchSize] = useState("10");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [selectedHit, setSelectedHit] = useState<ElasticHit | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDetail(data as IndexDetail);
      else toast.error("Could not load index", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  // Auto-refresh Overview tab every 15s
  useEffect(() => {
    if (tab !== "overview") return;
    const i = setInterval(() => loadDetail(), 15_000);
    return () => clearInterval(i);
  }, [tab, loadDetail]);

  // Abort any in-flight search on unmount
  useEffect(
    () => () => {
      searchAbortRef.current?.abort();
    },
    []
  );

  const runSearch = async () => {
    searchAbortRef.current?.abort();
    const ac = new AbortController();
    searchAbortRef.current = ac;
    setSearching(true);
    setSearchResult(null);
    try {
      const size = Math.max(1, Math.min(100, Number(searchSize) || 10));
      const res = await fetch(`${base}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: searchQuery, size }),
        signal: ac.signal,
      });
      const data = await res.json();
      if (res.ok) setSearchResult(data as SearchResult);
      else toast.error("Search failed", { description: data.error });
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        toast.error("Search failed");
      }
    } finally {
      setSearching(false);
    }
  };

  const deleteIndex = async () => {
    setBusy(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        toast.success("Index deleted");
        router.push(`/elastic/${connectionId}/indices`);
      } else toast.error(data.error || "Could not delete");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const idx = detail?.index;
  const settingsSplit = useMemo(
    () => (detail ? splitSettings(detail.settings) : null),
    [detail]
  );

  return (
    <WorkspacePage
      title={
        <span className="font-mono inline-flex items-center gap-2">
          {name}
          {idx ? (
            <>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider",
                  HEALTH_TEXT[idx.health]
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    HEALTH_DOT[idx.health]
                  )}
                />
                {idx.health}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {formatCompact(idx.docs)} docs · {formatBytes(idx.sizeBytes)}
              </span>
              <Badge
                variant="outline"
                className="text-[10px] font-mono"
                title="primaries × replicas"
              >
                {idx.primaries} × {idx.replicas}
              </Badge>
              {idx.system ? (
                <Badge
                  variant="outline"
                  className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground"
                >
                  system
                </Badge>
              ) : null}
            </>
          ) : null}
        </span>
      }
      actions={
        <>
          <Link
            href={`/elastic/${connectionId}/indices`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={loadDetail}
            disabled={loading}
          >
            <RefreshCcw
              className={cn("size-3.5", loading && "animate-spin")}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
          >
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="mappings">Mappings</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="shards">Shards</TabsTrigger>
        </TabsList>

        {/* ── Overview ───────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="pt-4 space-y-4">
          {idx ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile
                  label="Docs"
                  value={formatCompact(idx.docs)}
                  sub={`${formatCompact(idx.deletedDocs)} deleted`}
                />
                <StatTile
                  label="Size"
                  value={formatBytes(idx.sizeBytes)}
                  sub={`${formatBytes(idx.primarySizeBytes)} primaries`}
                />
                <StatTile
                  label="Shards"
                  value={`${idx.primaries} × ${idx.replicas}`}
                  sub={`${detail!.shards.length} total shard${detail!.shards.length === 1 ? "" : "s"}`}
                />
                <StatTile
                  label="Refresh"
                  value={idx.refreshInterval}
                  sub="interval"
                />
              </div>
              <div className="rounded-lg border border-border/60 p-4">
                <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Aliases
                </p>
                {idx.aliases.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No aliases.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {idx.aliases.map((a) => (
                      <span
                        key={a}
                        className="inline-flex items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80"
                      >
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Mappings ───────────────────────────────────────────────────── */}
        <TabsContent value="mappings" className="pt-4">
          {detail ? (
            <DetailBlock
              label="Mappings"
              content={JSON.stringify(detail.mappings, null, 2)}
            />
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </TabsContent>

        {/* ── Settings ───────────────────────────────────────────────────── */}
        <TabsContent value="settings" className="pt-4 space-y-3">
          {detail && settingsSplit ? (
            <>
              <DetailBlock
                label="Settings"
                content={JSON.stringify(settingsSplit.display, null, 2)}
              />
              {Object.keys(settingsSplit.metadata).length > 0 ? (
                <div className="text-[10px] font-mono text-muted-foreground space-y-0.5">
                  <p className="uppercase tracking-[0.18em]">Metadata</p>
                  {Object.entries(settingsSplit.metadata).map(([k, v]) => (
                    <p key={k} className="break-all">
                      {k}:{" "}
                      <span className="text-foreground/70">
                        {typeof v === "object"
                          ? JSON.stringify(v)
                          : String(v)}
                      </span>
                    </p>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </TabsContent>

        {/* ── Search ─────────────────────────────────────────────────────── */}
        <TabsContent value="search" className="pt-4 space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[260px] space-y-1">
              <Label
                htmlFor="es-query"
                className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
              >
                Query (Lucene)
              </Label>
              <div className="relative">
                <SearchIcon className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  id="es-query"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runSearch();
                    }
                  }}
                  placeholder='e.g. name:foo AND status:active  (empty = match_all)'
                  className="h-8 pl-8 font-mono text-xs"
                  spellCheck={false}
                />
              </div>
            </div>
            <div className="space-y-1 w-20">
              <Label
                htmlFor="es-size"
                className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
              >
                Size
              </Label>
              <Input
                id="es-size"
                type="number"
                min={1}
                max={100}
                value={searchSize}
                onChange={(e) => setSearchSize(e.target.value)}
                className="h-8 font-mono text-xs tabular-nums"
              />
            </div>
            <Button size="sm" onClick={runSearch} disabled={searching}>
              {searching ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <SearchIcon className="size-3.5" />
              )}
              Run
            </Button>
          </div>

          {searching ? (
            <p className="text-sm text-muted-foreground">Searching…</p>
          ) : searchResult === null ? (
            <p className="text-sm text-muted-foreground">
              Enter a query and hit Run.
            </p>
          ) : searchResult.hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hits.</p>
          ) : (
            <>
              <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {formatCompact(searchResult.total)} total ·{" "}
                {searchResult.hits.length} shown
              </p>
              <div className="space-y-2">
                {searchResult.hits.map((h, i) => (
                  <HitCard
                    key={`${h._id}-${i}`}
                    hit={h}
                    onOpen={() => setSelectedHit(h)}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        {/* ── Shards ─────────────────────────────────────────────────────── */}
        <TabsContent value="shards" className="pt-4">
          {detail ? (
            detail.shards.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shard data.</p>
            ) : (
              <div className="rounded-lg border border-border/60 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/30">
                    <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      <th className="px-3 py-2 text-left w-[80px]">Shard</th>
                      <th className="px-3 py-2 text-left w-[80px]">Prirep</th>
                      <th className="px-3 py-2 text-left w-[110px]">State</th>
                      <th className="px-3 py-2 text-left w-[100px]">Docs</th>
                      <th className="px-3 py-2 text-left w-[100px]">Store</th>
                      <th className="px-3 py-2 text-left">Node</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.shards.map((s, i) => (
                      <tr
                        key={`${s.shard}-${s.prirep}-${i}`}
                        className="border-t border-border/40 hover:bg-muted/30"
                      >
                        <td className="px-3 py-1.5 font-mono text-xs tabular-nums">
                          {s.shard}
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className={cn(
                              "inline-block min-w-[20px] text-center rounded px-1 font-mono text-[10px]",
                              s.prirep === "p"
                                ? "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                                : "bg-muted text-muted-foreground"
                            )}
                          >
                            {s.prirep.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <ShardStatePill state={s.state} />
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatCompact(s.docs)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                          {formatBytes(s.store)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-xs truncate">
                          {s.node || (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <Skeleton className="h-32 w-full" />
          )}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete index?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes{" "}
              <span className="font-mono">{name}</span> and all its documents.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteIndex}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <HitDetailSheet
        hit={selectedHit}
        indexName={name}
        onClose={() => setSelectedHit(null)}
      />
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4">
      <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">
        {sub}
      </p>
    </div>
  );
}

function ShardStatePill({ state }: { state: string }) {
  const cls =
    state === "STARTED"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : state === "RELOCATING" || state === "INITIALIZING"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : state === "UNASSIGNED"
          ? "bg-red-500/10 text-red-700 dark:text-red-300"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        cls
      )}
    >
      {state || "—"}
    </span>
  );
}

function HitCard({
  hit,
  onOpen,
}: {
  hit: ElasticHit;
  onOpen: () => void;
}) {
  const preview = useMemo(() => {
    try {
      return JSON.stringify(hit._source);
    } catch {
      return "";
    }
  }, [hit._source]);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-lg border border-border/60 bg-card/40 hover:bg-muted/40 transition-colors p-3 space-y-1.5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs truncate">
          <span className="text-muted-foreground">_id</span>{" "}
          <span>{hit._id}</span>
        </span>
        {hit._score != null ? (
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            score {hit._score.toFixed(3)}
          </span>
        ) : null}
      </div>
      <p className="font-mono text-xs text-muted-foreground truncate">
        {preview}
      </p>
    </button>
  );
}

function HitDetailSheet({
  hit,
  indexName,
  onClose,
}: {
  hit: ElasticHit | null;
  indexName: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={Boolean(hit)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col gap-0 p-0"
      >
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle className="text-base flex items-center gap-2">
            <span className="font-mono">{indexName}</span>
            {hit ? (
              <span className="text-xs font-mono text-muted-foreground">
                · _id {hit._id}
                {hit._score != null ? (
                  <span className="ml-1">· score {hit._score.toFixed(3)}</span>
                ) : null}
              </span>
            ) : null}
          </SheetTitle>
        </SheetHeader>
        {hit ? (
          <div className="flex-1 min-h-0 overflow-auto p-5">
            <DetailBlock
              label="_source"
              content={JSON.stringify(hit._source, null, 2)}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DetailBlock({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy");
    }
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <Button
          size="xs"
          variant="ghost"
          onClick={onCopy}
          className="h-6 px-2"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "copied" : "copy"}
        </Button>
      </div>
      <pre className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
        {content}
      </pre>
    </div>
  );
}
