"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowDownUp, ArrowLeft, Search } from "lucide-react";
import { RefreshButton } from "@/components/workspace/auto-refresh";

interface DatabaseDetail {
  name: string;
  state: string;
  recoveryModel: string | null;
  compatibilityLevel: number | null;
  collation: string | null;
  sizeBytes: number;
  tableCount: number;
}

interface TableSummary {
  name: string;
  schema: string;
  rows: number;
  sizeBytes: number;
}

interface Payload {
  database: DatabaseDetail;
  tables: TableSummary[];
}

interface Props {
  connectionId: string;
  database: string;
}

type SortKey = "name" | "rows" | "size";
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

function stateClasses(state: string): string {
  const s = state.toUpperCase();
  if (s === "ONLINE")
    return "text-emerald-700 dark:text-emerald-400";
  if (s === "OFFLINE" || s === "RESTORING" || s === "EMERGENCY")
    return "text-red-700 dark:text-red-400";
  return "text-amber-700 dark:text-amber-400";
}

function stateDot(state: string): string {
  const s = state.toUpperCase();
  if (s === "ONLINE") return "bg-emerald-500";
  if (s === "OFFLINE" || s === "RESTORING" || s === "EMERGENCY")
    return "bg-red-500";
  return "bg-amber-500";
}

export function DatabaseDetailClient({ connectionId, database }: Props) {
  const base = `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/tables`;

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
      else
        toast.error("Could not load database", {
          description: payload.error,
        });
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
    if (q)
      out = out.filter((t) =>
        `${t.schema}.${t.name}`.toLowerCase().includes(q)
      );
    out = [...out].sort((a, b) => {
      const mult = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "name")
        return (
          `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`) * mult
        );
      if (sort.key === "rows") return (a.rows - b.rows) * mult;
      return (a.sizeBytes - b.sizeBytes) * mult;
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
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  return (
    <WorkspacePage
      title={<span className="font-mono">{database}</span>}
      description={
        data
          ? `${data.database.tableCount} table${data.database.tableCount === 1 ? "" : "s"} · ${formatBytes(data.database.sizeBytes)}${data.database.recoveryModel ? ` · ${data.database.recoveryModel.toLowerCase()} recovery` : ""}`
          : undefined
      }
      actions={
        <>
          <Link
            href={`/sqlserver/${connectionId}/databases`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Link>
          {data ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider",
                stateClasses(data.database.state)
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  stateDot(data.database.state)
                )}
              />
              {data.database.state.toLowerCase()}
            </span>
          ) : null}
          <RefreshButton onClick={load} loading={loading} />
        </>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
        <TabsList>
          <TabsTrigger value="tables">Tables</TabsTrigger>
          <TabsTrigger value="programmability">Programmability</TabsTrigger>
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
                ? "No user tables in this database."
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
                      label="Rows"
                      keyName="rows"
                      sort={sort}
                      onClick={toggleSort}
                      className="px-3 py-2 text-left w-[120px]"
                    />
                    <SortableTh
                      label="Reserved"
                      keyName="size"
                      sort={sort}
                      onClick={toggleSort}
                      className="px-3 py-2 text-left w-[42%]"
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
                        key={`${t.schema}.${t.name}`}
                        className="border-t border-border/40 hover:bg-muted/30"
                      >
                        <td className="px-3 py-2 align-middle">
                          <Link
                            href={`/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/tables/${encodeURIComponent(t.schema)}/${encodeURIComponent(t.name)}`}
                            className="font-mono text-xs truncate hover:text-brand hover:underline"
                          >
                            <span className="text-muted-foreground">
                              {t.schema}.
                            </span>
                            {t.name}
                          </Link>
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
                                    : "bg-gradient-to-r from-red-500/70 to-rose-600/70"
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="programmability" className="pt-4">
          <ProgrammabilityPanel connectionId={connectionId} database={database} />
        </TabsContent>

        <TabsContent value="info" className="pt-4">
          {data === null ? (
            <Skeleton className="h-40 w-full max-w-xl" />
          ) : (
            <div className="rounded-lg border border-border/60 overflow-hidden max-w-xl">
              <table className="w-full text-xs">
                <tbody>
                  <InfoRow label="Database" value={data.database.name} mono />
                  <InfoRow label="State" value={data.database.state} mono />
                  <InfoRow
                    label="Recovery model"
                    value={data.database.recoveryModel ?? "—"}
                    mono
                  />
                  <InfoRow
                    label="Collation"
                    value={data.database.collation ?? "—"}
                    mono
                  />
                  <InfoRow
                    label="Compatibility level"
                    value={
                      data.database.compatibilityLevel != null
                        ? String(data.database.compatibilityLevel)
                        : "—"
                    }
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

interface ObjectRow {
  schema: string;
  name: string;
  kind: string;
}

const KIND_GROUP: Record<string, string> = {
  view: "Views",
  proc: "Stored procedures",
  scalar_fn: "Functions",
  table_fn: "Functions",
  trigger: "Triggers",
  synonym: "Synonyms",
};

function ProgrammabilityPanel({
  connectionId,
  database,
}: {
  connectionId: string;
  database: string;
}) {
  const [objects, setObjects] = useState<ObjectRow[] | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/objects`,
        { cache: "no-store" },
      );
      const d = await res.json();
      if (res.ok) setObjects(d.objects as ObjectRow[]);
      else toast.error("Could not load objects", { description: d.error });
    })();
  }, [connectionId, database]);

  if (!objects) return <Skeleton className="h-40 w-full" />;

  const nonTable = objects.filter((o) => o.kind !== "table");
  if (nonTable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No views, procedures, functions, or triggers.
      </p>
    );
  }

  const groups = new Map<string, ObjectRow[]>();
  for (const o of nonTable) {
    const g = KIND_GROUP[o.kind] ?? "Other";
    const arr = groups.get(g) ?? [];
    arr.push(o);
    groups.set(g, arr);
  }

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          <h3 className="text-xs uppercase tracking-wider font-mono text-muted-foreground mb-2">
            {group} ({items.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
            {items.map((o) => (
              <Link
                key={`${o.schema}.${o.name}.${o.kind}`}
                href={`/sqlserver/${connectionId}/databases/${encodeURIComponent(database)}/modules/${encodeURIComponent(o.schema)}/${encodeURIComponent(o.name)}`}
                className="rounded-md border border-border/60 bg-card/40 px-3 py-1.5 font-mono text-xs hover:border-border hover:text-brand transition-colors truncate"
              >
                <span className="text-muted-foreground">{o.schema}.</span>
                {o.name}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
