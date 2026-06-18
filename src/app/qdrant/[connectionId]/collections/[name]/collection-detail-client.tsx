"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
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
import type {
  CollectionDetail,
  QdrantPoint,
  SearchHit,
} from "@/lib/connections/qdrant";

// ─── types ────────────────────────────────────────────────────────────────────

interface DetailProps {
  connectionId: string;
  name: string;
  initial:
    | { ok: true; detail: CollectionDetail }
    | { ok: false; error: string };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function vectorPreview(vec: number[]): string {
  const preview = vec
    .slice(0, 4)
    .map((n) => n.toFixed(3))
    .join(", ");
  return `dim ${vec.length} · [${preview}${vec.length > 4 ? ", …" : ""}]`;
}

// ─── Points tab ───────────────────────────────────────────────────────────────

interface PointsTabProps {
  connectionId: string;
  name: string;
  hasNamedVectors: boolean;
  vectorName: string;
}

function PointsTab({
  connectionId,
  name,
  hasNamedVectors,
  vectorName,
}: PointsTabProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [points, setPoints] = useState<QdrantPoint[]>([]);
  const [nextOffset, setNextOffset] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(false);
  const [showVectors, setShowVectors] = useState(false);
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const loadPoints = async (
    offset: string | number | null,
    append: boolean,
    withVec: boolean,
  ) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: "25",
        withVector: withVec ? "1" : "0",
      });
      if (offset !== null && offset !== undefined) {
        params.set("offset", String(offset));
      }
      const res = await fetch(
        `/api/qdrant/${connectionId}/collections/${encodeURIComponent(name)}/points?${params}`,
        { signal: ac.signal },
      );
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error("Failed to load points", { description: data.error });
        return;
      }
      const data = (await res.json()) as {
        points: QdrantPoint[];
        nextOffset: string | number | null;
      };
      setPoints((prev) =>
        append ? [...prev, ...data.points] : data.points,
      );
      setNextOffset(data.nextOffset);
      if (!append) setSelected(new Set());
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        toast.error("Failed to load points", {
          description: (err as Error).message,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPoints(null, false, false); }, []);

  const handleToggleVectors = () => {
    const next = !showVectors;
    setShowVectors(next);
    loadPoints(null, false, next);
  };

  const handleLoadMore = () => {
    loadPoints(nextOffset, true, showVectors);
  };

  const toggleSelect = (id: string | number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === points.length && points.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(points.map((p) => p.id)));
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/qdrant/${connectionId}/collections/${encodeURIComponent(name)}/points`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [...selected] }),
        },
      );
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error("Delete failed", { description: data.error });
      } else {
        toast.success(
          `Deleted ${selected.size} point${selected.size === 1 ? "" : "s"}`,
        );
        setDeleteOpen(false);
        loadPoints(null, false, showVectors);
      }
    } finally {
      setDeleting(false);
    }
  };

  const getVecArray = (point: QdrantPoint): number[] | null => {
    if (!point.vector) return null;
    if (
      hasNamedVectors &&
      typeof point.vector === "object" &&
      !Array.isArray(point.vector)
    ) {
      return (
        (point.vector as Record<string, number[]>)[vectorName] ?? null
      );
    }
    return Array.isArray(point.vector) ? point.vector : null;
  };

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={handleToggleVectors}
          disabled={loading}
        >
          {showVectors ? "Hide vectors" : "Show vectors"}
        </Button>

        {selected.size > 0 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={loading}
          >
            <Trash2 className="size-3.5 mr-1.5" />
            Delete selected ({selected.size})
          </Button>
        )}
      </div>

      {loading && points.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" />
          Loading…
        </div>
      ) : points.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No points found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-border/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40">
                <th className="w-8 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={
                      selected.size === points.length && points.length > 0
                    }
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                  ID
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  Payload
                </th>
                {showVectors && (
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    Vector
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {points.map((point) => {
                const vecArr = showVectors ? getVecArray(point) : null;
                return (
                  <tr
                    key={String(point.id)}
                    className="hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => toggleSelect(point.id)}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(point.id)}
                        onChange={() => toggleSelect(point.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {String(point.id)}
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <pre className="text-xs font-mono max-h-24 overflow-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(point.payload, null, 2)}
                      </pre>
                    </td>
                    {showVectors && (
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {vecArr ? vectorPreview(vecArr) : "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextOffset !== null && !loading && points.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={handleLoadMore}
            disabled={loading}
          >
            Load more
          </Button>
        </div>
      )}

      {loading && points.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(v) => { if (!deleting) setDeleteOpen(v); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} point{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {selected.size} point
              {selected.size === 1 ? "" : "s"} from{" "}
              <span className="font-mono">{name}</span>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin mr-1.5" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Search tab ───────────────────────────────────────────────────────────────

interface SearchTabProps {
  connectionId: string;
  name: string;
  hasNamedVectors: boolean;
  vectorName: string;
}

function SearchTab({
  connectionId,
  name,
  hasNamedVectors,
  vectorName,
}: SearchTabProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<"id" | "vector">("id");
  const [pointIdInput, setPointIdInput] = useState("");
  const [vectorInput, setVectorInput] = useState("");
  const [filterInput, setFilterInput] = useState("");
  const [limit, setLimit] = useState(10);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const handleSearch = async () => {
    setError(null);

    const body: Record<string, unknown> = { limit };

    if (mode === "id") {
      const trimmed = pointIdInput.trim();
      if (!trimmed) {
        setError("Point ID is required");
        return;
      }
      const maybeNum = Number(trimmed);
      body.pointId = isNaN(maybeNum) ? trimmed : maybeNum;
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(vectorInput);
      } catch {
        setError("Invalid JSON vector");
        return;
      }
      if (!Array.isArray(parsed)) {
        setError("Vector must be a JSON array");
        return;
      }
      body.vector = parsed as number[];
    }

    if (filterInput.trim()) {
      try {
        body.filter = JSON.parse(filterInput);
      } catch {
        setError("Invalid JSON filter");
        return;
      }
    }

    if (hasNamedVectors && vectorName) {
      body.vectorName = vectorName;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setSearching(true);

    try {
      const res = await fetch(
        `/api/qdrant/${connectionId}/collections/${encodeURIComponent(name)}/search`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        },
      );
      const data = (await res.json()) as {
        hits?: SearchHit[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Search failed");
      } else {
        setHits(data.hits ?? []);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-1 p-0.5 rounded bg-muted w-fit">
        <button
          onClick={() => setMode("id")}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            mode === "id"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          By point ID
        </button>
        <button
          onClick={() => setMode("vector")}
          className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
            mode === "vector"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          By vector
        </button>
      </div>

      {/* Main input */}
      {mode === "id" ? (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Point ID</label>
          <input
            type="text"
            value={pointIdInput}
            onChange={(e) => setPointIdInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
            placeholder="e.g. 42 or abc-123"
            disabled={searching}
            className="w-full max-w-sm rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Vector (JSON array)</label>
          <textarea
            value={vectorInput}
            onChange={(e) => setVectorInput(e.target.value)}
            placeholder="[0.1, 0.2, 0.3, ...]"
            rows={4}
            disabled={searching}
            className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>
      )}

      {/* Limit + filter row */}
      <div className="flex gap-4 items-start">
        <div className="space-y-1.5 w-28">
          <label className="text-sm font-medium">Limit</label>
          <input
            type="number"
            min={1}
            max={100}
            value={limit}
            onChange={(e) =>
              setLimit(
                Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 10)),
              )
            }
            disabled={searching}
            className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <label className="text-sm font-medium">
            Filter{" "}
            <span className="text-muted-foreground font-normal">(optional JSON)</span>
          </label>
          <textarea
            value={filterInput}
            onChange={(e) => setFilterInput(e.target.value)}
            placeholder='{"must":[{"key":"city","match":{"value":"London"}}]}'
            rows={2}
            disabled={searching}
            className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs px-3 py-2">
          {error}
        </div>
      )}

      <Button onClick={handleSearch} disabled={searching} size="sm">
        {searching ? (
          <Loader2 className="size-3.5 animate-spin mr-1.5" />
        ) : null}
        Search
      </Button>

      {/* Results */}
      {hits !== null &&
        (hits.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            No results.
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-border/60">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/40">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    Score
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap">
                    ID
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Payload
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {hits.map((hit, i) => (
                  <tr
                    key={`${hit.id}-${i}`}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-amber-600 dark:text-amber-400">
                      {hit.score.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {String(hit.id)}
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <pre className="text-xs font-mono max-h-24 overflow-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(hit.payload, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

// ─── Config tab ───────────────────────────────────────────────────────────────

function ConfigTab({ detail }: { detail: CollectionDetail }) {
  const { vectors, status, pointsCount, payloadSchema } = detail;
  const schemaEntries = Object.entries(payloadSchema);

  return (
    <div className="space-y-6 max-w-xl">
      <section>
        <h3 className="text-sm font-semibold mb-3">Collection</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-4">
            <dt className="w-32 text-muted-foreground shrink-0">Status</dt>
            <dd className="font-mono">{status}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-32 text-muted-foreground shrink-0">Points</dt>
            <dd className="tabular-nums">{pointsCount.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">Vectors</h3>
        {vectors.named.length > 0 ? (
          <ul className="space-y-1">
            {vectors.named.map((n) => (
              <li key={n} className="font-mono text-xs text-muted-foreground">
                {n}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm font-mono text-muted-foreground">
            {vectors.size !== null ? String(vectors.size) : "?"} ·{" "}
            {vectors.distance ?? "?"}
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-3">Payload indexes</h3>
        {schemaEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payload indexes.</p>
        ) : (
          <dl className="space-y-1.5">
            {schemaEntries.map(([key, val]) => (
              <div key={key} className="flex gap-4 text-sm">
                <dt className="font-mono text-xs text-muted-foreground shrink-0 w-44 truncate">
                  {key}
                </dt>
                <dd className="font-mono text-xs">
                  {(val as { data_type?: string })?.data_type ?? String(val)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function CollectionDetailClient({
  connectionId,
  name,
  initial,
}: DetailProps) {
  // Hooks must be called unconditionally — state initialized before early return
  const [vectorName, setVectorName] = useState<string>(
    initial.ok ? (initial.detail.vectors.named[0] ?? "") : "",
  );

  if (!initial.ok) {
    return (
      <div className="rounded border border-red-500/40 bg-red-500/5 text-red-600 dark:text-red-400 text-xs font-mono px-3 py-2">
        {initial.error}
      </div>
    );
  }

  const { detail } = initial;
  const hasNamedVectors = detail.vectors.named.length > 0;

  return (
    <div className="space-y-4">
      {hasNamedVectors && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Vector:</span>
          <select
            value={vectorName}
            onChange={(e) => setVectorName(e.target.value)}
            className="rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {detail.vectors.named.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}

      <Tabs defaultValue="points" className="space-y-4">
        <TabsList>
          <TabsTrigger value="points">Points</TabsTrigger>
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="points">
          <PointsTab
            connectionId={connectionId}
            name={name}
            hasNamedVectors={hasNamedVectors}
            vectorName={vectorName}
          />
        </TabsContent>

        <TabsContent value="search">
          <SearchTab
            connectionId={connectionId}
            name={name}
            hasNamedVectors={hasNamedVectors}
            vectorName={vectorName}
          />
        </TabsContent>

        <TabsContent value="config">
          <ConfigTab detail={detail} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
