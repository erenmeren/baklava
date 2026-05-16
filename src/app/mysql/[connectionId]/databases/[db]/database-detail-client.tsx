"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowDownUp, ArrowLeft, RefreshCcw, Search } from "lucide-react";

interface DatabaseDetail {
  name: string;
  charset: string | null;
  collation: string | null;
  sizeBytes: number;
  tableCount: number;
}

interface TableSummary {
  name: string;
  engine: string | null;
  rows: number;
  sizeBytes: number;
  collation: string | null;
}

interface Payload {
  database: DatabaseDetail;
  tables: TableSummary[];
}

interface Props {
  connectionId: string;
  database: string;
}

type SortKey = "name" | "engine" | "rows" | "size" | "collation";
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

function formatRows(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} K`;
  if (n < 1_000_000_000)
    return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} M`;
  return `${(n / 1_000_000_000).toFixed(1)} B`;
}

export function DatabaseDetailClient({ connectionId, database }: Props) {
  const base = `/api/mysql/${connectionId}/databases/${encodeURIComponent(database)}/tables`;

  const [tab, setTab] = useState("tables");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "size",
    dir: "desc",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(base, { cache: "no-store" });
      const payload = await res.json();
      if (res.ok) setData(payload as Payload);
      else toast.error("Could not load database", { description: payload.error });
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const q = search.trim().toLowerCase();
    let out = data.tables;
    if (q) out = out.filter((t) => t.name.toLowerCase().includes(q));
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name) * mult;
      if (sort.key === "engine")
        return (a.engine ?? "").localeCompare(b.engine ?? "") * mult;
      if (sort.key === "rows") return (a.rows - b.rows) * mult;
      if (sort.key === "size") return (a.sizeBytes - b.sizeBytes) * mult;
      return (a.collation ?? "").localeCompare(b.collation ?? "") * mult;
    });
    return out;
  }, [data, search, sort]);

  const maxBytes = useMemo(
    () => data?.tables.reduce((m, t) => Math.max(m, t.sizeBytes), 0) ?? 0,
    [data]
  );

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" || key === "engine" || key === "collation" ? "asc" : "desc" }
    );
  };

  return (
    <WorkspacePage
      title={<span className="font-mono">{database}</span>}
      description={
        data
          ? `${data.database.tableCount} table${data.database.tableCount === 1 ? "" : "s"} · ${formatBytes(data.database.sizeBytes)}${data.database.collation ? ` · ${data.database.collation}` : ""}`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/mysql/${connectionId}/databases`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          <Button
            size="sm"
            variant="outline"
            onClick={load}
            disabled={loading}
          >
            <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="tables">Tables</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>

        <TabsContent value="tables" className="pt-4 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tables…"
                className="h-8 pl-8 text-xs"
                spellCheck={false}
              />
            </div>
            {data && filtered ? (
              <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                {filtered.length === data.tables.length
                  ? `${data.tables.length} table${data.tables.length === 1 ? "" : "s"}`
                  : `${filtered.length} of ${data.tables.length}`}
              </span>
            ) : null}
          </div>

          {data === null ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered && filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground text-sm">
              {data.tables.length === 0
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
                    <SortableTh
                      label="Engine"
                      keyName="engine"
                      sort={sort}
                      onClick={toggleSort}
                      className="px-3 py-2 text-left w-[110px]"
                    />
                    <SortableTh
                      label="Rows"
                      keyName="rows"
                      sort={sort}
                      onClick={toggleSort}
                      className="px-3 py-2 text-left w-[100px]"
                    />
                    <SortableTh
                      label="Size"
                      keyName="size"
                      sort={sort}
                      onClick={toggleSort}
                      className="px-3 py-2 text-left w-[36%]"
                    />
                    <SortableTh
                      label="Collation"
                      keyName="collation"
                      sort={sort}
                      onClick={toggleSort}
                      className="px-3 py-2 text-left w-[22%]"
                    />
                  </tr>
                </thead>
                <tbody>
                  {filtered!.map((t) => {
                    const pct =
                      maxBytes > 0
                        ? Math.min(100, (t.sizeBytes / maxBytes) * 100)
                        : 0;
                    return (
                      <tr
                        key={t.name}
                        className="border-t border-border/40 hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 align-middle">
                          <span className="font-mono text-xs truncate">
                            {t.name}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-middle">
                          {t.engine ? (
                            <Badge
                              variant="secondary"
                              className="text-[9px] font-mono uppercase tracking-wider"
                            >
                              {t.engine}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-middle font-mono text-xs tabular-nums text-muted-foreground">
                          {formatRows(t.rows)}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs tabular-nums w-16 text-right text-muted-foreground">
                              {formatBytes(t.sizeBytes)}
                            </span>
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[60px]">
                              <div
                                className={cn(
                                  "h-full rounded-full transition-all",
                                  t.sizeBytes === 0
                                    ? "bg-muted"
                                    : "bg-gradient-to-r from-cyan-500/70 to-blue-600/70"
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle font-mono text-[11px] text-muted-foreground truncate">
                          {t.collation ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="info" className="pt-4">
          {data === null ? (
            <Skeleton className="h-40 w-full max-w-xl" />
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden max-w-xl">
              <table className="w-full text-xs">
                <tbody>
                  <InfoRow label="Database" value={data.database.name} mono />
                  <InfoRow label="Charset" value={data.database.charset ?? "—"} mono />
                  <InfoRow
                    label="Collation"
                    value={data.database.collation ?? "—"}
                    mono
                  />
                  <InfoRow
                    label="Total tables"
                    value={String(data.database.tableCount)}
                    mono
                  />
                  <InfoRow
                    label="Total size"
                    value={formatBytes(data.database.sizeBytes)}
                    mono
                  />
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <tr className="border-b border-border/40 last:border-b-0">
      <td className="px-3 py-2 align-top text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground w-[40%]">
        {label}
      </td>
      <td className={cn("px-3 py-2 align-top", mono && "font-mono")}>
        {value}
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
