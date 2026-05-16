"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

interface GroupStat {
  groupId: string;
  protocolType: string;
  state?: string;
  memberCount: number;
  topicCount: number;
  totalLag: number;
}

interface Props {
  connectionId: string;
}

type SortKey = "lag" | "name" | "members";
type SortDir = "asc" | "desc";

const fmt = new Intl.NumberFormat("en-US");

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

const STATE_TONE: Record<string, string> = {
  Stable:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  Empty:
    "bg-muted text-muted-foreground border-border/60",
  PreparingRebalance:
    "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  CompletingRebalance:
    "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
  Dead: "bg-destructive/10 text-destructive border-destructive/30",
};

export function ConsumerGroupsClient({ connectionId }: Props) {
  const [groups, setGroups] = useState<GroupStat[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "lag",
    dir: "desc",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/kafka/${connectionId}/consumer-groups?lag=1`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (res.ok) setGroups(data.groups as GroupStat[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const maxLag = useMemo(
    () => groups?.reduce((m, g) => Math.max(m, g.totalLag), 0) ?? 0,
    [groups]
  );

  const filtered = useMemo(() => {
    if (!groups) return null;
    const q = search.trim().toLowerCase();
    let out = q ? groups.filter((g) => g.groupId.toLowerCase().includes(q)) : groups;
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.groupId.localeCompare(b.groupId) * mult;
      if (sort.key === "members") return (a.memberCount - b.memberCount) * mult;
      return (a.totalLag - b.totalLag) * mult;
    });
    return out;
  }, [groups, search, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  const totalLag = useMemo(
    () => groups?.reduce((s, g) => s + g.totalLag, 0) ?? 0,
    [groups]
  );

  return (
    <WorkspacePage
      title="Consumer groups"
      description={
        groups
          ? `${groups.length} group${groups.length === 1 ? "" : "s"} · ${formatCompact(totalLag)} total lag`
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
              placeholder="Search groups…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
        </div>

        {groups === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {groups.length === 0
              ? "No consumer groups."
              : "No groups match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Group"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <th className="px-3 py-2 text-left w-[120px]">State</th>
                  <SortableTh
                    label="Total lag"
                    keyName="lag"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[26%]"
                  />
                  <SortableTh
                    label="Members"
                    keyName="members"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[100px]"
                  />
                  <th className="px-3 py-2 text-left w-[100px]">Topics</th>
                  <th className="px-3 py-2 text-left w-[100px]">Protocol</th>
                </tr>
              </thead>
              <tbody>
                {filtered!.map((g) => (
                  <GroupRow
                    key={g.groupId}
                    group={g}
                    connectionId={connectionId}
                    maxLag={maxLag}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function GroupRow({
  group,
  connectionId,
  maxLag,
}: {
  group: GroupStat;
  connectionId: string;
  maxLag: number;
}) {
  const lagPct =
    maxLag > 0 ? Math.min(100, (group.totalLag / maxLag) * 100) : 0;
  const tone =
    group.totalLag === 0
      ? "ok"
      : group.totalLag < 1000
        ? "low"
        : group.totalLag < 10_000
          ? "med"
          : "high";
  const lagBar =
    tone === "ok"
      ? "bg-emerald-500/60"
      : tone === "low"
        ? "bg-emerald-500"
        : tone === "med"
          ? "bg-amber-500"
          : "bg-red-500";
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <Link
          href={`/kafka/${connectionId}/consumer-groups/${encodeURIComponent(group.groupId)}`}
          className="font-mono text-xs hover:underline truncate inline-block max-w-full"
        >
          {group.groupId}
        </Link>
      </td>
      <td className="px-3 py-2 align-middle">
        {group.state ? (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-mono uppercase tracking-wider",
              STATE_TONE[group.state] ||
                "bg-secondary text-secondary-foreground border-border/60"
            )}
          >
            {group.state}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground/60">—</span>
        )}
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "font-mono text-xs tabular-nums w-16 text-right",
              tone === "ok" && "text-muted-foreground",
              tone === "high" && "text-red-600 dark:text-red-400 font-semibold"
            )}
          >
            {formatCompact(group.totalLag)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn("h-full rounded-full transition-all", lagBar)}
              style={{ width: `${Math.max(lagPct, group.totalLag > 0 ? 4 : 0)}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            group.memberCount === 0 && "text-muted-foreground/60"
          )}
        >
          {fmt.format(group.memberCount)}
        </span>
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            group.topicCount === 0 && "text-muted-foreground/60"
          )}
        >
          {fmt.format(group.topicCount)}
        </span>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
        {group.protocolType || "—"}
      </td>
    </tr>
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
