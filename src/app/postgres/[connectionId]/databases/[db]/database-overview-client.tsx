"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePage } from "@/components/workspace/workspace-page";
import {
  ArrowLeft,
  Database,
  FileCode2,
  GitBranch,
  HardDrive,
  Layers,
  ListOrdered,
  Plus,
  SquareTerminal,
  Table as TableIcon,
  View,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CreateSchemaDialog } from "../../create-schema-dialog";

interface SchemaStats {
  name: string;
  owner: string;
  tables: number;
  views: number;
  materializedViews: number;
  sequences: number;
  functions: number;
  totalSize: number;
}

interface TopTable {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view";
  rowEstimate: number;
  totalSize: number;
  indexSize: number;
}

interface Props {
  connectionId: string;
  connectionName: string;
  database: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  for (const u of units) {
    if (value < 1024) {
      return `${value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ${u}`;
    }
    value /= 1024;
  }
  return `${Math.round(value)} PB`;
}
function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function DatabaseOverviewClient({
  connectionId,
  connectionName,
  database,
}: Props) {
  const [schemas, setSchemas] = useState<SchemaStats[] | null>(null);
  const [topTables, setTopTables] = useState<TopTable[] | null>(null);
  const [createSchemaOpen, setCreateSchemaOpen] = useState(false);

  const load = useCallback(async () => {
    const [sRes, tRes] = await Promise.all([
      fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas`,
        { cache: "no-store" },
      ),
      fetch(
        `/api/postgres/${connectionId}/databases/${encodeURIComponent(database)}/top-tables?limit=10`,
        { cache: "no-store" },
      ),
    ]);
    if (sRes.ok) {
      const data = (await sRes.json()) as { schemas: SchemaStats[] };
      setSchemas(data.schemas);
    }
    if (tRes.ok) {
      const data = (await tRes.json()) as { tables: TopTable[] };
      setTopTables(data.tables);
    }
  }, [connectionId, database]);

  useEffect(() => {
    void load();
  }, [load]);

  // Hide pg_catalog, information_schema by default — those are listed
  // in listSchemasWithStats too if the server includes them, but our
  // SQL already filters them out.
  const totalObjects = schemas
    ? schemas.reduce(
        (s, sc) =>
          s + sc.tables + sc.views + sc.materializedViews + sc.sequences,
        0,
      )
    : 0;
  const totalSize = schemas
    ? schemas.reduce((s, sc) => s + sc.totalSize, 0)
    : 0;

  return (
    <WorkspacePage
      title={
        <span className="inline-flex items-center gap-2">
          <Database className="size-5 text-brand" />
          <span className="font-mono">{database}</span>
        </span>
      }
      description={
        schemas ? (
          <span className="text-xs font-mono text-muted-foreground">
            {connectionName} · {schemas.length} schema
            {schemas.length === 1 ? "" : "s"} ·{" "}
            {formatNumber(totalObjects)} object{totalObjects === 1 ? "" : "s"}{" "}
            · {formatBytes(totalSize)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">loading…</span>
        )
      }
      actions={
        <>
          <Link
            href={`/postgres/${connectionId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Server overview
          </Link>
          <Link
            href={`/postgres/${connectionId}/databases/${encodeURIComponent(database)}/query`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-border bg-background",
              "px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors",
            )}
          >
            <SquareTerminal className="size-3.5" />
            Open SQL editor
          </Link>
          <Button size="sm" onClick={() => setCreateSchemaOpen(true)}>
            <Plus className="size-3.5" />
            New schema
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Schemas — primary content, 2/3 columns */}
        <section className="lg:col-span-2">
          <SectionHeader
            icon={Layers}
            title="Schemas"
            subtitle={
              schemas == null
                ? "loading"
                : `${schemas.length} schema${schemas.length === 1 ? "" : "s"}`
            }
          />
          {schemas == null ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : schemas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 p-10 text-center">
              <p className="text-sm text-muted-foreground">
                This database has no schemas yet.
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => setCreateSchemaOpen(true)}
              >
                <Plus className="size-3.5" />
                Create your first schema
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {schemas.map((s) => (
                <SchemaCard
                  key={s.name}
                  schema={s}
                  connectionId={connectionId}
                  database={database}
                />
              ))}
            </div>
          )}
        </section>

        {/* Top tables — 1/3 column on the right */}
        <section>
          <SectionHeader
            icon={TableIcon}
            title="Largest tables"
            subtitle={
              topTables == null
                ? "loading"
                : `top ${topTables.length} in ${database}`
            }
          />
          <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden divide-y divide-border/40">
            {topTables == null ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : topTables.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No user tables.
              </p>
            ) : (
              topTables.map((t) => (
                <Link
                  key={`${t.schema}.${t.name}`}
                  href={`/postgres/${connectionId}/databases/${encodeURIComponent(database)}/schemas/${encodeURIComponent(t.schema)}/tables/${encodeURIComponent(t.name)}`}
                  className="block group px-3 py-1.5 hover:bg-muted/30"
                >
                  <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <span className="font-mono text-xs truncate">
                      <span className="text-muted-foreground">{t.schema}.</span>
                      <span className="text-foreground">{t.name}</span>
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">
                      {formatBytes(t.totalSize)}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">
                    ~{formatNumber(t.rowEstimate)} rows · index{" "}
                    {formatBytes(t.indexSize)}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      <CreateSchemaDialog
        connectionId={connectionId}
        database={database}
        open={createSchemaOpen}
        onOpenChange={setCreateSchemaOpen}
        onCreated={load}
      />
    </WorkspacePage>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Database;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      <Icon className="size-3 text-muted-foreground translate-y-[1px]" />
      <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </h2>
      {subtitle ? (
        <span className="text-[10px] font-mono text-muted-foreground/70 tabular-nums">
          · {subtitle}
        </span>
      ) : null}
    </div>
  );
}

function SchemaCard({
  schema,
  connectionId,
  database,
}: {
  schema: SchemaStats;
  connectionId: string;
  database: string;
}) {
  // The card's primary click target is the SQL editor pre-filled with a
  // query that lists everything in this schema — at least one path that
  // actually does something useful today. Once per-schema browse pages
  // exist, the card can link straight there instead.
  const editorHref = `/postgres/${connectionId}/databases/${encodeURIComponent(database)}/query?prefill=${encodeURIComponent(
    `-- objects in schema "${schema.name}"\nSELECT n.nspname AS schema, c.relname AS name,\n       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view'\n                       WHEN 'm' THEN 'matview' WHEN 'S' THEN 'sequence'\n                       ELSE c.relkind::text END AS kind\nFROM pg_class c\nJOIN pg_namespace n ON n.oid = c.relnamespace\nWHERE n.nspname = '${schema.name}'\n  AND c.relkind IN ('r','v','m','S')\nORDER BY kind, name;`,
  )}`;

  const counts = [
    { icon: TableIcon, label: "tables", count: schema.tables },
    {
      icon: View,
      label: "views",
      count: schema.views + schema.materializedViews,
      sub:
        schema.materializedViews > 0
          ? `${schema.materializedViews} mat.`
          : undefined,
    },
    { icon: FileCode2, label: "functions", count: schema.functions },
    { icon: ListOrdered, label: "sequences", count: schema.sequences },
  ];

  const isEmpty =
    schema.tables +
      schema.views +
      schema.materializedViews +
      schema.sequences +
      schema.functions ===
    0;

  return (
    <Link
      href={editorHref}
      className={cn(
        "group/card relative block overflow-hidden rounded-xl border bg-card/40 px-4 py-3",
        "border-border/60 hover:border-brand/50 hover:bg-card/70 transition-colors",
        isEmpty && "opacity-70",
      )}
      title={`Open SQL editor and list objects in ${schema.name}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 size-20 rounded-full blur-3xl opacity-40 bg-brand/15 group-hover/card:opacity-70 transition-opacity"
      />
      <header className="flex items-baseline justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <GitBranch className="size-3 text-brand translate-y-[1px]" />
            <h3
              className="font-mono text-sm font-semibold truncate"
              title={schema.name}
            >
              {schema.name}
            </h3>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground tabular-nums">
            owner {schema.owner}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-xs tabular-nums text-muted-foreground inline-flex items-center gap-1">
            <HardDrive className="size-2.5" />
            {formatBytes(schema.totalSize)}
          </div>
        </div>
      </header>
      <div className="grid grid-cols-4 gap-1">
        {counts.map((c) => {
          const Icon = c.icon;
          const muted = c.count === 0;
          return (
            <div
              key={c.label}
              className={cn(
                "rounded-md border border-border/60 px-2 py-1.5 text-center",
                muted ? "bg-muted/20" : "bg-background",
              )}
            >
              <div className="flex items-center justify-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
                <Icon className="size-2.5" />
                {c.label}
              </div>
              <div
                className={cn(
                  "mt-0.5 font-mono text-sm tabular-nums",
                  muted && "text-muted-foreground/40",
                )}
                style={{
                  fontFamily:
                    "var(--font-jetbrains-mono), ui-monospace, monospace",
                }}
              >
                {c.count}
              </div>
              {c.sub ? (
                <div className="text-[9px] font-mono text-muted-foreground/70">
                  {c.sub}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60 group-hover/card:text-brand transition-colors">
        Open in editor →
      </div>
    </Link>
  );
}
