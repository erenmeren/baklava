"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

interface DatabaseSummary {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
  collectionCount: number;
  system: boolean;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "size" | "collections";
type SortDir = "asc" | "desc";

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DatabasesClient({ connectionId }: Props) {
  const [databases, setDatabases] = useState<DatabaseSummary[] | null>(null);
  const [includeSystem, setIncludeSystem] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "size",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/mongo/${connectionId}/databases`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setDatabases(data.databases as DatabaseSummary[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!databases) return null;
    const q = search.trim().toLowerCase();
    let out = databases;
    if (!includeSystem) out = out.filter((d) => !d.system);
    if (q) out = out.filter((d) => d.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "size") return (a.sizeOnDisk - b.sizeOnDisk) * mult;
      return (a.collectionCount - b.collectionCount) * mult;
    });
    return out;
  }, [databases, search, includeSystem, sort]);

  const maxSize = useMemo(
    () => databases?.reduce((m, d) => Math.max(m, d.sizeOnDisk), 0) ?? 0,
    [databases]
  );

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  return (
    <WorkspacePage
      title="Databases"
      description={
        filtered && databases
          ? filtered.length === databases.length
            ? `${databases.length} database${databases.length === 1 ? "" : "s"} · ${formatBytes(databases.reduce((s, d) => s + d.sizeOnDisk, 0))}`
            : `${filtered.length} of ${databases.length}`
          : undefined
      }
      actions={
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search databases…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              id="show-system"
              size="sm"
              checked={includeSystem}
              onCheckedChange={setIncludeSystem}
            />
            <Label
              htmlFor="show-system"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Show system
            </Label>
          </div>
        </div>

        {databases === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {databases.length === 0
              ? "No databases on this server."
              : "No databases match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Database"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <SortableTh
                    label="Size"
                    keyName="size"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[36%]"
                  />
                  <SortableTh
                    label="Collections"
                    keyName="collections"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[120px]"
                  />
                </tr>
              </thead>
              <tbody>
                {filtered!.map((d) => {
                  const pct =
                    maxSize > 0
                      ? Math.min(100, (d.sizeOnDisk / maxSize) * 100)
                      : 0;
                  return (
                    <tr
                      key={d.name}
                      className="border-t border-border/40 hover:bg-muted/30"
                    >
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-mono text-xs truncate">
                            {d.name}
                          </span>
                          {d.system ? (
                            <Badge
                              variant="secondary"
                              className="text-[9px] font-mono uppercase tracking-wider"
                            >
                              system
                            </Badge>
                          ) : null}
                          {d.empty ? (
                            <Badge
                              variant="outline"
                              className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground border-border/60"
                            >
                              empty
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs tabular-nums w-20 text-right text-muted-foreground">
                            {formatBytes(d.sizeOnDisk)}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                d.sizeOnDisk === 0
                                  ? "bg-muted"
                                  : "bg-gradient-to-r from-emerald-500/70 to-green-500/70"
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
                        {d.collectionCount}
                      </td>
                    </tr>
                  );
                })}
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
