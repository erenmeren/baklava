"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { formatBytes } from "@/components/workspace/format";
import { RelativeTime } from "@/components/workspace/relative-time";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ArrowDownUp, RefreshCcw, Search } from "lucide-react";

interface TableRow {
  name: string;
  engine: string;
  rows: number;
  bytes: number;
  modifiedAt: string | null;
}

interface Props {
  connectionId: string;
}

type SortKey = "name" | "rows" | "bytes" | "modified";
type SortDir = "asc" | "desc";

function formatCompact(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}

function parseTimestamp(s: string | null): number {
  if (!s) return 0;
  // ClickHouse DateTime serialized as 'YYYY-MM-DD HH:MM:SS' (UTC) — coerce to ISO
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function TablesClient({ connectionId }: Props) {
  const [tables, setTables] = useState<TableRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "rows",
    dir: "desc",
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clickhouse/${connectionId}/tables`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (res.ok) setTables(data.tables as TableRow[]);
      else toast.error("Could not load", { description: data.error });
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!tables) return null;
    const q = search.trim().toLowerCase();
    let out = tables;
    if (q)
      out = out.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.engine.toLowerCase().includes(q)
      );
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "rows") return (a.rows - b.rows) * mult;
      if (sort.key === "bytes") return (a.bytes - b.bytes) * mult;
      return (parseTimestamp(a.modifiedAt) - parseTimestamp(b.modifiedAt)) * mult;
    });
    return out;
  }, [tables, search, sort]);

  const maxRows = useMemo(
    () => tables?.reduce((m, t) => Math.max(m, t.rows), 0) ?? 0,
    [tables]
  );

  const totalRows = useMemo(
    () => tables?.reduce((s, t) => s + t.rows, 0) ?? 0,
    [tables]
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
      title="Tables"
      description={
        filtered && tables
          ? filtered.length === tables.length
            ? `${tables.length} table${tables.length === 1 ? "" : "s"} · ${formatCompact(totalRows)} rows`
            : `${filtered.length} of ${tables.length}`
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
        {/* ── Filter strip ───────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tables or engines…"
              className="h-8 pl-8 text-xs"
              spellCheck={false}
            />
          </div>
        </div>

        {/* ── Tables table ──────────────────────────────────────────────── */}
        {tables === null ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered && filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
            {tables.length === 0
              ? "No tables in this database."
              : "No tables match the current filter."}
          </div>
        ) : (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <table className="w-full">
              <thead className="bg-muted/30">
                <tr className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <SortableTh
                    label="Table"
                    keyName="name"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left"
                  />
                  <th className="px-3 py-2 text-left w-[180px]">Engine</th>
                  <SortableTh
                    label="Rows"
                    keyName="rows"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[28%]"
                  />
                  <SortableTh
                    label="Bytes"
                    keyName="bytes"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[110px]"
                  />
                  <SortableTh
                    label="Modified"
                    keyName="modified"
                    sort={sort}
                    onClick={toggleSort}
                    className="px-3 py-2 text-left w-[120px]"
                  />
                </tr>
              </thead>
              <tbody>
                {filtered!.map((t) => (
                  <TableRowItem key={t.name} t={t} maxRows={maxRows} />
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

function TableRowItem({ t, maxRows }: { t: TableRow; maxRows: number }) {
  const pct = maxRows > 0 ? Math.min(100, (t.rows / maxRows) * 100) : 0;
  const ts = parseTimestamp(t.modifiedAt);
  return (
    <tr className="border-t border-border/40 hover:bg-muted/30">
      <td className="px-3 py-2 align-middle">
        <span className="font-mono text-xs truncate">{t.name}</span>
      </td>
      <td className="px-3 py-2 align-middle">
        <span
          className="inline-flex items-center rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-foreground/80"
          title={t.engine}
        >
          {t.engine}
        </span>
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums w-14 text-right text-muted-foreground">
            {formatCompact(t.rows)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                t.rows === 0
                  ? "bg-muted"
                  : "bg-gradient-to-r from-yellow-500/70 to-orange-500/70"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums text-muted-foreground">
        {formatBytes(t.bytes)}
      </td>
      <td className="px-3 py-2 align-middle font-mono text-xs text-muted-foreground">
        {ts > 0 ? <RelativeTime value={ts} /> : "—"}
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
