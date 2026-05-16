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
  sizeBytes: number;
  tableCount: number;
  isSystem: boolean;
  state: string;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "size" | "tables";
type SortDir = "asc" | "desc";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} K`;
  if (n < 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} M`;
  if (n < 1024 * 1024 * 1024 * 1024)
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} G`;
  return `${(n / (1024 * 1024 * 1024 * 1024)).toFixed(1)} T`;
}

export function DatabasesClient({ connectionId }: Props) {
  const [databases, setDatabases] = useState<DatabaseSummary[] | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "size",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sqlserver/${connectionId}/databases`, {
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
    if (!showSystem) out = out.filter((d) => !d.isSystem);
    if (q) out = out.filter((d) => d.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "size") return (a.sizeBytes - b.sizeBytes) * mult;
      return (a.tableCount - b.tableCount) * mult;
    });
    return out;
  }, [databases, search, showSystem, sort]);

  const maxBytes = useMemo(
    () => databases?.reduce((m, d) => Math.max(m, d.sizeBytes), 0) ?? 0,
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
            ? `${databases.length} database${databases.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${databases.length}`
          : undefined
      }
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={load}
          disabled={loading}
        >
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
              id="show-system-mssql"
              size="sm"
              checked={showSystem}
              onCheckedChange={setShowSystem}
            />
            <Label
              htmlFor="show-system-mssql"
              className="cursor-pointer text-xs font-normal text-muted-foreground"
            >
              Show system
            </Label>
          </div>
        </div>

        {databases === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {databases.length === 0
              ? "No databases on this instance."
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
                    className="px-3 py-2 text-left w-[32%]"
                  />
                  <SortableTh
                    label="Tables"
                    keyName="tables"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[100px]"
                  />
                  <th className="px-3 py-2 text-left w-[100px]">State</th>
                </tr>
              </thead>
              <tbody>
                {filtered!.map((d) => {
                  const pct =
                    maxBytes > 0
                      ? Math.min(100, (d.sizeBytes / maxBytes) * 100)
                      : 0;
                  const online = d.state.toUpperCase() === "ONLINE";
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
                          {d.isSystem ? (
                            <Badge
                              variant="secondary"
                              className="text-[9px] font-mono uppercase tracking-wider"
                            >
                              system
                            </Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs tabular-nums w-16 text-right text-muted-foreground">
                            {formatBytes(d.sizeBytes)}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                d.sizeBytes === 0
                                  ? "bg-muted"
                                  : "bg-gradient-to-r from-red-500/70 to-rose-600/70"
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums">
                        {d.tableCount}
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider",
                            online
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-amber-700 dark:text-amber-400"
                          )}
                        >
                          <span
                            className={cn(
                              "size-1.5 rounded-full",
                              online ? "bg-emerald-500" : "bg-amber-500"
                            )}
                          />
                          {d.state.toLowerCase()}
                        </span>
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
