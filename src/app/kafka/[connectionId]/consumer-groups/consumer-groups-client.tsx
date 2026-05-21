"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { AutoRefresh } from "@/components/workspace/auto-refresh";
import { Sparkline } from "@/components/workspace/sparkline";
import {
  HeatLegend,
  PartitionCell,
  PartitionHeatmapGrid,
} from "@/components/workspace/partition-heatmap";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  ChevronRight,
  ExternalLink,
  Layers,
  PinIcon,
  PinOff,
  Search,
  Trash2,
  Users,
} from "lucide-react";

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

type SortKey = "lag" | "name" | "members" | "rate" | "eta";
type SortDir = "asc" | "desc";

const fmt = new Intl.NumberFormat("en-US");
const HISTORY_CAP = 30; // 30 polls × 5s = 2.5 min of lag history per group
const STUCK_LOOKBACK = 3; // a group is "stuck" if lag rose and offset stayed for 3 polls
const REFRESH_MS = 5_000;

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

// ─── Drain rate + ETA ─────────────────────────────────────────────────────
// Both derive purely from the per-group totalLag ring buffer (no API change).
// What we can measure from the list is *net* lag velocity (consumption minus
// production), not gross consumer throughput — committed-offset deltas aren't
// in this payload. Net velocity is exactly what answers "will this drain?",
// so we label it as a lag/drain rate, never as "throughput".
const DRAIN_WINDOW = 12; // fit over the last ~1 min (12 × 5s) — responsive but stable
const DRAIN_MIN_SAMPLES = 3; // need a few points before a slope means anything

type DrainStatus = "measuring" | "draining" | "growing" | "stalled" | "drained";

interface DrainInfo {
  status: DrainStatus;
  ratePerSec: number; // signed: < 0 = lag shrinking (draining), > 0 = growing
  etaSeconds: number | null; // set only when draining
}

// Least-squares slope over the buffer rather than a last-two-point delta —
// a single noisy poll otherwise whipsaws the rate and ETA. Samples are evenly
// spaced REFRESH_MS apart, so x is just the sample index.
function computeDrain(history: number[], currentLag: number): DrainInfo {
  if (currentLag === 0) {
    return { status: "drained", ratePerSec: 0, etaSeconds: 0 };
  }
  if (history.length < DRAIN_MIN_SAMPLES) {
    return { status: "measuring", ratePerSec: 0, etaSeconds: null };
  }
  const win = history.slice(-DRAIN_WINDOW);
  const n = win.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += win[i];
    sumXY += i * win[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slopePerSample = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const ratePerSec = slopePerSample / (REFRESH_MS / 1000);

  // Dead-band: treat sub-0.05%/s drift as flat so a basically-idle group with
  // jittery offsets doesn't flicker between "draining" and "growing".
  const noiseFloor = Math.max(1, currentLag * 0.0005);
  if (Math.abs(ratePerSec) < noiseFloor) {
    return { status: "stalled", ratePerSec: 0, etaSeconds: null };
  }
  if (ratePerSec > 0) {
    return { status: "growing", ratePerSec, etaSeconds: null };
  }
  return { status: "draining", ratePerSec, etaSeconds: currentLag / -ratePerSec };
}

// Collapse a DrainInfo to a single comparable number so the ETA column sorts
// sensibly: already-drained first, then soonest-to-drain, with groups that
// never drain (growing / stalled / still measuring) pushed to the far end.
function etaSortValue(d: DrainInfo | undefined): number {
  if (!d) return Number.POSITIVE_INFINITY;
  if (d.status === "drained") return 0;
  if (d.status === "draining" && d.etaSeconds != null) return d.etaSeconds;
  return Number.POSITIVE_INFINITY;
}

function formatRate(ratePerSec: number): string {
  const mag = Math.abs(ratePerSec);
  const body = mag < 10 ? mag.toFixed(1) : formatCompact(Math.round(mag));
  const sign = ratePerSec > 0 ? "+" : ratePerSec < 0 ? "−" : "";
  return `${sign}${body}/s`;
}

function formatEta(seconds: number): string {
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
  }
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
  }
  const d = Math.floor(seconds / 86_400);
  const h = Math.round((seconds % 86_400) / 3600);
  return h > 0 ? `~${d}d ${h}h` : `~${d}d`;
}

const STATE_TONE: Record<string, string> = {
  Stable:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  Empty: "bg-muted text-muted-foreground border-border/60",
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

  // Per-group lag history (client-side ring buffer). Stored in state so
  // the React purity rules let it be read during render. Survives polls
  // but resets on full navigation — that's fine, it's an aesthetic signal.
  const [lagHistory, setLagHistory] = useState<Map<string, number[]>>(
    () => new Map(),
  );

  // Bulk selection (Phase C): only empty groups are selectable.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Filters (Phase D)
  type QuickFilter = "all" | "has-lag" | "has-members" | "stuck" | "empty";
  const [stateFilter, setStateFilter] = useState<string | "all">("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  // Pinned groups (Phase D): persisted to localStorage, scoped per
  // connection so the same kafka cluster keeps its pins.
  const PIN_KEY = `baklava:kafka:${connectionId}:pinned-groups`;
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PIN_KEY);
      if (raw) setPinned(new Set(JSON.parse(raw)));
    } catch {
      // ignore — localStorage may be unavailable
    }
  }, [PIN_KEY]);
  const togglePin = useCallback(
    (groupId: string) => {
      setPinned((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) next.delete(groupId);
        else next.add(groupId);
        try {
          window.localStorage.setItem(PIN_KEY, JSON.stringify([...next]));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [PIN_KEY],
  );

  // Inline expansion (the accordion). Multiple groups can be open at once so
  // operators can compare two groups' partition heatmaps side by side.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((groupId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const setRowSelected = useCallback((groupId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/kafka/${connectionId}/consumer-groups?lag=1`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error("Could not load", { description: data.error });
        return;
      }
      const next = data.groups as GroupStat[];
      // Build a fresh Map so React picks up the change (copy-on-write keeps
      // purity intact and Maps of ≤ a few hundred entries are cheap).
      setLagHistory((prev) => {
        const fresh = new Map(prev);
        const seen = new Set<string>();
        for (const g of next) {
          seen.add(g.groupId);
          const buf = [...(fresh.get(g.groupId) ?? []), g.totalLag];
          if (buf.length > HISTORY_CAP) buf.shift();
          fresh.set(g.groupId, buf);
        }
        for (const key of fresh.keys()) {
          if (!seen.has(key)) fresh.delete(key);
        }
        return fresh;
      });
      setGroups(next);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxLag = useMemo(
    () => groups?.reduce((m, g) => Math.max(m, g.totalLag), 0) ?? 0,
    [groups],
  );

  // Build the stuck set once per render so filters and the row both agree.
  const stuckSet = useMemo(() => {
    const set = new Set<string>();
    if (!groups) return set;
    for (const g of groups) {
      const hist = lagHistory.get(g.groupId) ?? [];
      if (
        hist.length >= STUCK_LOOKBACK + 1 &&
        g.totalLag > 0 &&
        g.memberCount > 0
      ) {
        const tail = hist.slice(-(STUCK_LOOKBACK + 1));
        if (
          tail[tail.length - 1] > tail[0] &&
          tail.every((v, i) => i === 0 || v >= tail[i - 1] - 1)
        ) {
          set.add(g.groupId);
        }
      }
    }
    return set;
  }, [groups, lagHistory]);

  // Drain rate + ETA per group, computed once per render off the lag buffer so
  // the sort comparator and the row cells read identical numbers.
  const drainByGroup = useMemo(() => {
    const map = new Map<string, DrainInfo>();
    if (!groups) return map;
    for (const g of groups) {
      map.set(g.groupId, computeDrain(lagHistory.get(g.groupId) ?? [], g.totalLag));
    }
    return map;
  }, [groups, lagHistory]);

  const filtered = useMemo(() => {
    if (!groups) return null;
    const q = search.trim().toLowerCase();
    let out = q ? groups.filter((g) => g.groupId.toLowerCase().includes(q)) : groups;
    if (stateFilter !== "all") {
      out = out.filter((g) => (g.state ?? "") === stateFilter);
    }
    if (quickFilter === "has-lag") {
      out = out.filter((g) => g.totalLag > 0);
    } else if (quickFilter === "has-members") {
      out = out.filter((g) => g.memberCount > 0);
    } else if (quickFilter === "stuck") {
      out = out.filter((g) => stuckSet.has(g.groupId));
    } else if (quickFilter === "empty") {
      out = out.filter((g) => g.memberCount === 0);
    }
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.groupId.localeCompare(b.groupId) * mult;
      if (sort.key === "members") return (a.memberCount - b.memberCount) * mult;
      if (sort.key === "rate") {
        const ar = drainByGroup.get(a.groupId)?.ratePerSec ?? 0;
        const br = drainByGroup.get(b.groupId)?.ratePerSec ?? 0;
        return (ar - br) * mult;
      }
      if (sort.key === "eta") {
        return (
          (etaSortValue(drainByGroup.get(a.groupId)) -
            etaSortValue(drainByGroup.get(b.groupId))) *
          mult
        );
      }
      return (a.totalLag - b.totalLag) * mult;
    });
    return out;
  }, [groups, search, sort, stateFilter, quickFilter, stuckSet, drainByGroup]);

  // Split into pinned / unpinned so pinned rows always render at the top.
  const { pinnedRows, restRows } = useMemo(() => {
    if (!filtered) return { pinnedRows: [], restRows: [] };
    const p: GroupStat[] = [];
    const r: GroupStat[] = [];
    for (const g of filtered) {
      if (pinned.has(g.groupId)) p.push(g);
      else r.push(g);
    }
    return { pinnedRows: p, restRows: r };
  }, [filtered, pinned]);

  // State chip counts (always counted over the full set, not the filtered).
  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!groups) return counts;
    for (const g of groups) {
      const k = g.state ?? "Unknown";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [groups]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "eta" ? "asc" : "desc" },
    );
  };

  // ─── KPI calculations ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!groups) {
      return {
        total: 0,
        stuck: 0,
        active: 0,
        empty: 0,
        totalLag: 0,
        totalMembers: 0,
      };
    }
    let stuck = 0;
    let active = 0;
    let empty = 0;
    let totalLag = 0;
    let totalMembers = 0;
    for (const g of groups) {
      totalLag += g.totalLag;
      totalMembers += g.memberCount;
      if (g.memberCount === 0) empty += 1;
      else active += 1;
      if (stuckSet.has(g.groupId)) stuck += 1;
    }
    return { total: groups.length, stuck, active, empty, totalLag, totalMembers };
  }, [groups, stuckSet]);

  const submitBulkDelete = async () => {
    setBulkBusy(true);
    try {
      const res = await fetch(
        `/api/kafka/${connectionId}/consumer-groups/bulk-delete`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ groupIds: [...selected] }),
        },
      );
      const data = await res.json();
      if (res.ok) {
        const deleted = data.deleted?.length ?? 0;
        const failed = data.failed?.length ?? 0;
        if (failed > 0) {
          toast.warning(
            `Deleted ${deleted}, failed ${failed} (some may not be Empty)`,
          );
        } else {
          toast.success(
            `Deleted ${deleted} group${deleted === 1 ? "" : "s"}`,
          );
        }
        setSelected(new Set());
        setBulkDeleteOpen(false);
        await load();
      } else {
        toast.error(data.error || "Bulk delete failed");
      }
    } finally {
      setBulkBusy(false);
    }
  };

  // Renders a group row plus, when open, the inline expansion row beneath it.
  // Shared by the pinned and unpinned tbodies so both behave identically.
  const renderRow = (g: GroupStat, isPinned: boolean) => {
    const isOpen = expanded.has(g.groupId);
    return (
      <Fragment key={g.groupId}>
        <GroupRow
          group={g}
          connectionId={connectionId}
          maxLag={maxLag}
          lagHistory={lagHistory.get(g.groupId) ?? []}
          drain={
            drainByGroup.get(g.groupId) ?? {
              status: "measuring",
              ratePerSec: 0,
              etaSeconds: null,
            }
          }
          isStuck={stuckSet.has(g.groupId)}
          isPinned={isPinned}
          isExpanded={isOpen}
          onToggleExpand={() => toggleExpand(g.groupId)}
          onTogglePin={() => togglePin(g.groupId)}
          selected={selected.has(g.groupId)}
          onToggleSelect={(checked) => setRowSelected(g.groupId, checked)}
        />
        {isOpen ? (
          <tr className="border-t border-border/40">
            <td colSpan={10} className="p-0 bg-muted/[0.18]">
              <GroupExpansion
                connectionId={connectionId}
                groupId={g.groupId}
              />
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <WorkspacePage
      title="Consumer groups"
      description={
        groups
          ? `${groups.length} group${groups.length === 1 ? "" : "s"} · ${formatCompact(stats.totalLag)} total lag`
          : undefined
      }
      actions={
        <AutoRefresh
          intervalMs={REFRESH_MS}
          onTick={load}
          loading={loading}
        />
      }
    >
      <div className="space-y-4">
        {/* KPI strip */}
        <KpiStrip stats={stats} loading={groups === null} />

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
          {selected.size > 0 ? (
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/5",
                "px-3 py-1 animate-in fade-in-0 slide-in-from-right-4 duration-200",
              )}
            >
              <span className="text-xs font-mono tabular-nums text-red-700 dark:text-red-400">
                {selected.size} selected
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setSelected(new Set())}
                className="text-muted-foreground"
              >
                Clear
              </Button>
              <Button
                size="xs"
                variant="destructive"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2 className="size-3" />
                Delete empty
              </Button>
            </div>
          ) : null}
        </div>

        {/* Filter chips */}
        <FilterChipRow>
          <FilterChip
            label="All"
            count={groups?.length ?? 0}
            active={stateFilter === "all"}
            onClick={() => setStateFilter("all")}
          />
          {Object.keys(STATE_TONE).map((s) => {
            const count = stateCounts.get(s) ?? 0;
            if (count === 0 && stateFilter !== s) return null;
            return (
              <FilterChip
                key={s}
                label={s}
                count={count}
                active={stateFilter === s}
                tone={s === "Dead" ? "alert" : s === "Stable" ? "ok" : "neutral"}
                onClick={() => setStateFilter(s)}
              />
            );
          })}
          <span className="mx-1 self-center h-3 w-px bg-border" aria-hidden />
          <FilterChip
            label="Has lag"
            count={(groups ?? []).filter((g) => g.totalLag > 0).length}
            active={quickFilter === "has-lag"}
            onClick={() =>
              setQuickFilter((q) => (q === "has-lag" ? "all" : "has-lag"))
            }
          />
          <FilterChip
            label="Has members"
            count={(groups ?? []).filter((g) => g.memberCount > 0).length}
            active={quickFilter === "has-members"}
            onClick={() =>
              setQuickFilter((q) =>
                q === "has-members" ? "all" : "has-members",
              )
            }
          />
          <FilterChip
            label="Stuck"
            count={stuckSet.size}
            tone="alert"
            active={quickFilter === "stuck"}
            onClick={() =>
              setQuickFilter((q) => (q === "stuck" ? "all" : "stuck"))
            }
          />
          <FilterChip
            label="Idle"
            count={(groups ?? []).filter((g) => g.memberCount === 0).length}
            active={quickFilter === "empty"}
            onClick={() =>
              setQuickFilter((q) => (q === "empty" ? "all" : "empty"))
            }
          />
        </FilterChipRow>

        {groups === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          groups.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              No groups match the current filter.{" "}
              <button
                type="button"
                onClick={() => {
                  setStateFilter("all");
                  setQuickFilter("all");
                  setSearch("");
                }}
                className="text-brand hover:underline"
              >
                Clear all filters
              </button>
            </div>
          )
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="w-9 px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      aria-label="Select all empty groups"
                      checked={
                        selected.size > 0 &&
                        (filtered ?? []).filter((g) => g.memberCount === 0)
                          .every((g) => selected.has(g.groupId))
                      }
                      onChange={(e) => {
                        const empties = (filtered ?? [])
                          .filter((g) => g.memberCount === 0)
                          .map((g) => g.groupId);
                        if (e.target.checked) {
                          setSelected(new Set(empties));
                        } else {
                          setSelected(new Set());
                        }
                      }}
                      className="size-3.5 accent-brand cursor-pointer"
                    />
                  </th>
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
                    className="px-3 py-2 text-left w-[22%]"
                  />
                  <th className="px-3 py-2 text-left w-[120px]">Trend</th>
                  <SortableTh
                    label="Rate"
                    keyName="rate"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[96px]"
                  />
                  <SortableTh
                    label="ETA"
                    keyName="eta"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[110px]"
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
              {pinnedRows.length > 0 ? (
                <tbody className="bg-brand/[0.03]">
                  <tr>
                    <td
                      colSpan={10}
                      className="px-3 py-1 text-[9px] font-mono uppercase tracking-[0.18em] text-brand/80 border-t border-brand/20"
                    >
                      <PinIcon className="inline size-2.5 mr-1" />
                      Pinned · {pinnedRows.length}
                    </td>
                  </tr>
                  {pinnedRows.map((g) => renderRow(g, true))}
                </tbody>
              ) : null}
              <tbody>{restRows.map((g) => renderRow(g, false))}</tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} empty group{selected.size === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Permanently removes the selected groups. Committed offsets are
              lost. Only empty groups (no active members) can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={submitBulkDelete}>
              {bulkBusy ? "Deleting…" : "Delete all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function KpiStrip({
  stats,
  loading,
}: {
  stats: {
    total: number;
    stuck: number;
    active: number;
    empty: number;
    totalLag: number;
    totalMembers: number;
  };
  loading: boolean;
}) {
  const items = [
    {
      icon: Layers,
      label: "Groups",
      value: loading ? "—" : fmt.format(stats.total),
      sub: loading ? "" : `${stats.active} active · ${stats.empty} empty`,
      tone: "neutral" as const,
    },
    {
      icon: AlertTriangle,
      label: "Stuck",
      value: loading ? "—" : fmt.format(stats.stuck),
      sub: stats.stuck > 0 ? "lag growing, offset frozen" : "all healthy",
      tone: stats.stuck > 0 ? ("alert" as const) : ("ok" as const),
    },
    {
      icon: Activity,
      label: "Total lag",
      value: loading ? "—" : formatCompact(stats.totalLag),
      sub: loading
        ? ""
        : stats.totalLag === 0
          ? "fully drained"
          : "messages behind",
      tone:
        stats.totalLag === 0
          ? ("ok" as const)
          : stats.totalLag > 100_000
            ? ("alert" as const)
            : ("neutral" as const),
    },
    {
      icon: Users,
      label: "Members",
      value: loading ? "—" : fmt.format(stats.totalMembers),
      sub: "across all groups",
      tone: "neutral" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div
            key={it.label}
            className={cn(
              "relative overflow-hidden rounded-xl border bg-card/40 px-4 py-3",
              it.tone === "alert"
                ? "border-red-500/40 bg-red-500/[0.04]"
                : it.tone === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/[0.03]"
                  : "border-border/60",
            )}
          >
            {/* subtle corner gloss */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute -right-6 -top-6 size-16 rounded-full blur-2xl opacity-50",
                it.tone === "alert"
                  ? "bg-red-500/30"
                  : it.tone === "ok"
                    ? "bg-emerald-500/30"
                    : "bg-brand/15",
              )}
            />
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              <Icon
                className={cn(
                  "size-3",
                  it.tone === "alert"
                    ? "text-red-500"
                    : it.tone === "ok"
                      ? "text-emerald-500"
                      : "text-brand",
                )}
              />
              {it.label}
            </div>
            <div
              className={cn(
                "mt-1.5 font-semibold tabular-nums text-2xl tracking-tight",
                it.tone === "alert" && "text-red-600 dark:text-red-400",
              )}
              style={{
                fontFamily:
                  "var(--font-jetbrains-mono), ui-monospace, monospace",
              }}
            >
              {it.value}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums truncate">
              {it.sub || " "}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function GroupRow({
  group,
  connectionId,
  maxLag,
  lagHistory,
  drain,
  isStuck,
  isPinned,
  isExpanded,
  onToggleExpand,
  onTogglePin,
  selected,
  onToggleSelect,
}: {
  group: GroupStat;
  connectionId: string;
  maxLag: number;
  lagHistory: number[];
  drain: DrainInfo;
  isStuck: boolean;
  isPinned: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onTogglePin: () => void;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
}) {
  const selectable = group.memberCount === 0;
  const lagPct = maxLag > 0 ? Math.min(100, (group.totalLag / maxLag) * 100) : 0;
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
    <tr
      onClick={onToggleExpand}
      aria-expanded={isExpanded}
      className={cn(
        "group/row cursor-pointer border-t border-border/40 hover:bg-muted/30 transition-colors",
        isStuck && "bg-red-500/[0.03]",
        selected && "bg-red-500/[0.05]",
        isExpanded && "bg-muted/40 hover:bg-muted/40",
      )}
    >
      <td
        className="w-9 px-2 py-2 text-center align-middle"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          aria-label={
            selectable
              ? `Select ${group.groupId}`
              : `${group.groupId} has active members — cannot delete`
          }
          disabled={!selectable}
          checked={selected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          className={cn(
            "size-3.5 accent-red-600 cursor-pointer",
            !selectable && "opacity-30 cursor-not-allowed",
          )}
          title={
            selectable
              ? "Select for bulk delete"
              : "Group has active members — bulk delete requires Empty groups"
          }
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-1.5 min-w-0">
          <ChevronRight
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/50 transition-transform duration-200",
              isExpanded && "rotate-90 text-brand",
            )}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            aria-label={isPinned ? "Unpin group" : "Pin group"}
            title={isPinned ? "Unpin" : "Pin to top"}
            className={cn(
              "inline-flex size-4 items-center justify-center rounded transition-colors shrink-0",
              isPinned
                ? "text-brand"
                : "text-muted-foreground/30 hover:text-foreground opacity-0 group-hover/row:opacity-100",
            )}
          >
            {isPinned ? (
              <PinIcon className="size-3" />
            ) : (
              <PinOff className="size-3" />
            )}
          </button>
          <Link
            href={`/kafka/${connectionId}/consumer-groups/${encodeURIComponent(group.groupId)}`}
            onClick={(e) => e.stopPropagation()}
            className="font-mono text-xs hover:underline truncate"
          >
            {group.groupId}
          </Link>
          {isStuck ? (
            <span
              title="Lag growing while offset is frozen — consumer may be stuck"
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10",
                "px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-red-600 dark:text-red-400",
              )}
            >
              <span className="size-1 rounded-full bg-red-500 status-pulse" />
              stuck
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        {group.state ? (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] font-mono uppercase tracking-wider",
              STATE_TONE[group.state] ||
                "bg-secondary text-secondary-foreground border-border/60",
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
              tone === "high" && "text-red-600 dark:text-red-400 font-semibold",
            )}
          >
            {formatCompact(group.totalLag)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn("h-full rounded-full transition-all", lagBar)}
              style={{
                width: `${Math.max(lagPct, group.totalLag > 0 ? 4 : 0)}%`,
              }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <Sparkline
          values={lagHistory}
          tone="lag"
          width={96}
          height={22}
          ariaLabel={`${group.groupId} lag trend`}
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <RateCell drain={drain} />
      </td>
      <td className="px-3 py-2 align-middle">
        <EtaCell drain={drain} />
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            group.memberCount === 0 && "text-muted-foreground/60",
          )}
        >
          {fmt.format(group.memberCount)}
        </span>
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className={cn(
            "font-mono text-xs tabular-nums",
            group.topicCount === 0 && "text-muted-foreground/60",
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

// Signed net lag velocity. Draining (lag shrinking) reads green with a down
// arrow; growing reads red with an up arrow; everything else is muted.
function RateCell({ drain }: { drain: DrainInfo }) {
  if (drain.status === "measuring") {
    return (
      <span className="font-mono text-[11px] text-muted-foreground/50 tabular-nums">
        measuring…
      </span>
    );
  }
  if (drain.status === "drained" || drain.status === "stalled") {
    return (
      <span className="font-mono text-xs text-muted-foreground/60 tabular-nums">
        0/s
      </span>
    );
  }
  const draining = drain.status === "draining";
  const Arrow = draining ? ArrowDown : ArrowUp;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs tabular-nums",
        draining
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400 font-semibold",
      )}
      title={
        draining
          ? "Net lag shrinking — group is catching up"
          : "Net lag growing — production is outpacing consumption"
      }
    >
      <Arrow className="size-3 shrink-0" />
      {formatRate(drain.ratePerSec)}
    </span>
  );
}

// Time-to-zero at the current drain rate. Only meaningful while draining;
// otherwise we say so plainly rather than inventing a number.
function EtaCell({ drain }: { drain: DrainInfo }) {
  if (drain.status === "drained") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
        drained
      </span>
    );
  }
  if (drain.status === "draining" && drain.etaSeconds != null) {
    return (
      <span
        className="font-mono text-xs tabular-nums text-foreground"
        title={`At the current rate, lag reaches zero in ~${Math.round(drain.etaSeconds)}s`}
      >
        {formatEta(drain.etaSeconds)}
      </span>
    );
  }
  if (drain.status === "growing") {
    return (
      <span
        className="font-mono text-[11px] uppercase tracking-wider text-red-600 dark:text-red-400"
        title="Lag is increasing — it will never drain at the current rate"
      >
        diverging
      </span>
    );
  }
  if (drain.status === "stalled") {
    return (
      <span
        className="font-mono text-[11px] uppercase tracking-wider text-amber-600 dark:text-amber-400"
        title="Lag is holding steady — not draining"
      >
        stalled
      </span>
    );
  }
  return (
    <span className="font-mono text-[11px] text-muted-foreground/50 tabular-nums">
      measuring…
    </span>
  );
}

// ─── Inline expansion: per-topic partition lag heatmap ────────────────────

interface GroupOffset {
  topic: string;
  partition: number;
  offset: string;
  high: string;
  lag: number;
  ownerMemberId?: string;
  ownerClientId?: string;
}

interface GroupDetail {
  groupId: string;
  state: string;
  protocolType?: string;
  protocol?: string;
  members: Array<{ memberId: string; clientId: string; clientHost: string }>;
  offsets: GroupOffset[];
}

function GroupExpansion({
  connectionId,
  groupId,
}: {
  connectionId: string;
  groupId: string;
}) {
  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchDetail = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(
        `/api/kafka/${connectionId}/consumer-groups/${encodeURIComponent(groupId)}`,
        { cache: "no-store", signal: ac.signal },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load group detail");
        return;
      }
      setError(null);
      setDetail(data as GroupDetail);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    }
  }, [connectionId, groupId]);

  // Fetch on open, then keep the heatmap live on the same cadence as the list.
  // The interval and any in-flight request are torn down when the row collapses
  // (this component unmounts), matching the SSE/abort convention in AGENTS.md.
  useEffect(() => {
    void fetchDetail();
    const t = setInterval(() => void fetchDetail(), REFRESH_MS);
    return () => {
      clearInterval(t);
      abortRef.current?.abort();
    };
  }, [fetchDetail]);

  const topics = useMemo(() => {
    if (!detail) return [];
    const byTopic = new Map<string, GroupOffset[]>();
    for (const o of detail.offsets) {
      const arr = byTopic.get(o.topic) ?? [];
      arr.push(o);
      byTopic.set(o.topic, arr);
    }
    return [...byTopic.entries()]
      .map(([topic, parts]) => {
        const sorted = [...parts].sort((a, b) => a.partition - b.partition);
        let totalLag = 0;
        const owners = new Set<string>();
        for (const p of sorted) {
          totalLag += p.lag;
          if (p.ownerClientId) owners.add(p.ownerClientId);
        }
        return { topic, parts: sorted, totalLag, owners: owners.size };
      })
      .sort((a, b) => b.totalLag - a.totalLag);
  }, [detail]);

  const groupMaxLag = useMemo(() => {
    if (!detail || detail.offsets.length === 0) return 0;
    return detail.offsets.reduce((m, o) => Math.max(m, o.lag), 0);
  }, [detail]);

  if (!detail && !error) {
    return (
      <div className="px-4 py-4 space-y-2 animate-in fade-in-0 duration-150">
        <Skeleton className="h-3.5 w-56" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 font-mono text-xs text-red-600 dark:text-red-400">
        {error}
      </div>
    );
  }

  const totalLag = detail!.offsets.reduce((s, o) => s + o.lag, 0);
  const totalParts = detail!.offsets.length;
  const fullHref = `/kafka/${connectionId}/consumer-groups/${encodeURIComponent(groupId)}`;

  return (
    <div className="px-4 py-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
      {/* summary header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
          <span className="tabular-nums">
            {topics.length} topic{topics.length === 1 ? "" : "s"}
          </span>
          <span aria-hidden className="h-3 w-px bg-border" />
          <span className="tabular-nums">
            {fmt.format(totalParts)} partition{totalParts === 1 ? "" : "s"}
          </span>
          <span aria-hidden className="h-3 w-px bg-border" />
          <span className="tabular-nums">
            {formatCompact(totalLag)} lag
          </span>
          <span aria-hidden className="h-3 w-px bg-border" />
          <span className="tabular-nums">
            {detail!.members.length} member
            {detail!.members.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <HeatLegend
            low="lag 0"
            high={formatCompact(groupMaxLag)}
            title="Box color encodes lag; the number inside is the partition's total message count"
          />
          <Link
            href={fullHref}
            className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
          >
            Open full view
            <ExternalLink className="size-3" />
          </Link>
        </div>
      </div>

      {totalParts === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center text-xs text-muted-foreground">
          This group has no committed offsets yet.
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {topics.map((t) => {
            // Shade relative to the worst partition in *this* topic so each
            // topic's internal skew is visible (matches the canonical heatmap).
            const topicMaxLag = Math.max(1, ...t.parts.map((p) => p.lag));
            return (
              <div
                key={t.topic}
                className="rounded-lg border border-border/50 bg-card/50 p-3"
              >
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-foreground">
                    {t.topic}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {t.parts.length}p · {formatCompact(t.totalLag)} lag
                    {t.owners > 0 ? ` · ${t.owners} owner${t.owners === 1 ? "" : "s"}` : ""}
                  </span>
                </div>
                <PartitionHeatmapGrid>
                  {t.parts.map((p) => {
                    const high = Number(p.high);
                    const known = high >= 0;
                    return (
                      <PartitionCell
                        key={p.partition}
                        data={{
                          partition: p.partition,
                          intensity:
                            p.lag === 0 ? 0 : Math.min(1, p.lag / topicMaxLag),
                          idle: !known || high === 0,
                          countLabel:
                            known && high > 0 ? formatCompact(high) : undefined,
                          owner: p.ownerClientId,
                          href: `/kafka/${connectionId}/topics/${encodeURIComponent(p.topic)}?tab=messages&partition=${p.partition}`,
                          tooltip: [
                            `partition ${p.partition}`,
                            known
                              ? `${fmt.format(high)} messages`
                              : "no messages produced yet",
                            `offset ${p.offset} / high ${p.high}`,
                            `lag ${fmt.format(p.lag)}`,
                            p.ownerClientId
                              ? `owned by ${p.ownerClientId}`
                              : "no owner",
                          ].join("\n"),
                        }}
                      />
                    );
                  })}
                </PartitionHeatmapGrid>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border/60 bg-muted/10 p-10 text-center">
      <div
        aria-hidden
        className="mx-auto mb-3 inline-flex size-12 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
      >
        <Users className="size-5" />
      </div>
      <h3
        className="text-lg font-semibold"
        style={{
          fontFamily: "var(--font-instrument-serif), Georgia, serif",
        }}
      >
        No consumer groups yet
      </h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
        Kafka registers a consumer group the first time a client calls{" "}
        <code className="font-mono text-xs px-1 py-0.5 rounded bg-muted">
          subscribe()
        </code>{" "}
        with a <span className="font-mono text-xs">groupId</span>. Start a
        consumer in your app, then refresh — it&apos;ll appear here with its
        members, partitions, and lag.
      </p>
    </div>
  );
}

function FilterChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">{children}</div>
  );
}

function FilterChip({
  label,
  count,
  active,
  tone = "neutral",
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone?: "neutral" | "ok" | "alert";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 transition-colors",
        "text-[10px] font-mono uppercase tracking-wider",
        active
          ? tone === "alert"
            ? "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-400"
            : tone === "ok"
              ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-brand/60 bg-brand/10 text-brand"
          : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {label}
      {count > 0 ? (
        <span
          className={cn(
            "text-[9px] tabular-nums",
            active ? "" : "text-muted-foreground/60",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
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
          active && "text-foreground",
        )}
      >
        {label}
        <ArrowDownUp
          className={cn(
            "size-3 opacity-0 transition-opacity",
            active && "opacity-60",
          )}
        />
      </button>
    </th>
  );
}
