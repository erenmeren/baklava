"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

interface PodSummary {
  name: string;
  namespace: string;
  phase: string;
  ready: string;
  readyAll: boolean;
  restarts: number;
  containers: number;
  podIp: string | null;
  nodeName: string | null;
  createdAt: string | null;
  state: "running" | "pending" | "succeeded" | "failed" | "unknown";
}

interface Namespace {
  name: string;
  phase: string;
}

interface Props {
  connectionId: string;
}

type SortKey = "namespace" | "name" | "restarts" | "createdAt";
type SortDir = "asc" | "desc";

const PHASE_TONES: Record<string, string> = {
  running: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  succeeded: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  unknown: "bg-muted text-muted-foreground border-border/60",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export function PodsClient({ connectionId }: Props) {
  const searchParams = useSearchParams();
  const initialNs = searchParams.get("ns") ?? "all";

  const [pods, setPods] = useState<PodSummary[] | null>(null);
  const [namespaces, setNamespaces] = useState<Namespace[] | null>(null);
  const [ns, setNs] = useState<string>(initialNs);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "namespace",
    dir: "asc",
  });

  const loadPods = useCallback(async () => {
    setLoading(true);
    try {
      const q = ns === "all" ? "" : `?namespace=${encodeURIComponent(ns)}`;
      const res = await fetch(`/api/kubernetes/${connectionId}/pods${q}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setPods(data.pods as PodSummary[]);
      else toast.error("Could not load pods", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId, ns]);

  const loadNamespaces = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/kubernetes/${connectionId}/namespaces`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setNamespaces(data.namespaces as Namespace[]);
    } catch {
      // non-fatal — keep "all" filter usable
    }
  }, [connectionId]);

  useEffect(() => {
    loadNamespaces();
  }, [loadNamespaces]);

  useEffect(() => {
    loadPods();
  }, [loadPods]);

  // auto-refresh
  useEffect(() => {
    const id = setInterval(loadPods, 15_000);
    return () => clearInterval(id);
  }, [loadPods]);

  const filtered = useMemo(() => {
    if (!pods) return null;
    const q = search.trim().toLowerCase();
    let out = q
      ? pods.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.namespace.toLowerCase().includes(q) ||
            (p.nodeName ?? "").toLowerCase().includes(q)
        )
      : pods;
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "namespace") {
        const ns = a.namespace.localeCompare(b.namespace);
        return (ns !== 0 ? ns : a.name.localeCompare(b.name)) * mult;
      }
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "restarts") return (a.restarts - b.restarts) * mult;
      if (sort.key === "createdAt") {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return (ta - tb) * mult;
      }
      return 0;
    });
    return out;
  }, [pods, search, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "namespace" || key === "name" ? "asc" : "desc" }
    );
  };

  return (
    <WorkspacePage
      title="Pods"
      description={
        pods
          ? `${pods.length} pod${pods.length === 1 ? "" : "s"}${ns === "all" ? " (all namespaces)" : ` in ${ns}`}`
          : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={loadPods} disabled={loading}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        {/* Filter strip */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Label
              htmlFor="ns-select"
              className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground"
            >
              Namespace
            </Label>
            <select
              id="ns-select"
              value={ns}
              onChange={(e) => setNs(e.target.value)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs font-mono"
            >
              <option value="all">All</option>
              {namespaces?.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search pods, nodes…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
        </div>

        {pods === null ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {pods.length === 0
              ? "No pods in this namespace."
              : "No pods match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Namespace"
                    keyName="namespace"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[140px]"
                  />
                  <SortableTh
                    label="Name"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <th className="px-3 py-2 text-left w-[80px]">Ready</th>
                  <th className="px-3 py-2 text-left w-[100px]">Phase</th>
                  <SortableTh
                    label="Restarts"
                    keyName="restarts"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[80px]"
                  />
                  <th className="px-3 py-2 text-left w-[140px]">Node</th>
                  <th className="px-3 py-2 text-left w-[100px]">IP</th>
                  <SortableTh
                    label="Age"
                    keyName="createdAt"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[60px]"
                  />
                </tr>
              </thead>
              <tbody>
                {filtered!.map((p) => (
                  <tr
                    key={`${p.namespace}/${p.name}`}
                    className="border-t border-border/40 hover:bg-muted/30"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground truncate">
                      {p.namespace}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/kubernetes/${connectionId}/pods/${encodeURIComponent(p.namespace)}/${encodeURIComponent(p.name)}`}
                        className="font-mono text-xs hover:underline truncate inline-block max-w-full"
                      >
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "font-mono text-xs",
                          p.readyAll
                            ? "text-foreground"
                            : "text-amber-600 dark:text-amber-400"
                        )}
                      >
                        {p.ready}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                          PHASE_TONES[p.state]
                        )}
                      >
                        {p.phase}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "font-mono text-xs tabular-nums",
                          p.restarts > 0
                            ? "text-amber-600 dark:text-amber-400 font-semibold"
                            : "text-muted-foreground"
                        )}
                      >
                        {p.restarts}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground truncate">
                      {p.nodeName ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {p.podIp ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground tabular-nums">
                      {relTime(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

function SortableTh({
  label,
  keyName,
  sort,
  onClick,
  className,
}: {
  label: string;
  keyName: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onClick: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === keyName;
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onClick(keyName)}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground transition-colors",
          active && "text-foreground"
        )}
      >
        {label}
        <ArrowDownUp
          className={cn(
            "size-3 opacity-0 transition-opacity",
            active && "opacity-60"
          )}
        />
      </button>
    </th>
  );
}
