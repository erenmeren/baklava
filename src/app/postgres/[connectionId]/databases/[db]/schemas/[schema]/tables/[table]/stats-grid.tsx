"use client";

import {
  formatBytes,
  formatNumber,
  formatRelative,
  type TableStats,
} from "./table-types";

export function StatsGrid({
  stats,
  columnCount,
  indexCount,
}: {
  stats: TableStats;
  columnCount: number | null;
  indexCount: number | null;
}) {
  // Views and materialized views aren't tracked in pg_stat_user_tables, so the
  // numbers we'd render would all be zero. Show a clear empty state instead.
  if (stats.relKind === "v") {
    return (
      <UnsupportedKind
        title="Statistics aren't tracked for views"
        hint="Postgres doesn't record activity counters for plain views — they're computed on read from their underlying tables."
      />
    );
  }
  if (stats.relKind === "m") {
    return (
      <UnsupportedKind
        title="Limited statistics for materialized views"
        hint="Storage figures are accurate. Activity counters live on the source tables, not on the materialized view itself."
        showStorageOnly
        stats={stats}
      />
    );
  }

  // The "last vacuum" / "last analyze" we show is the more recent of manual + auto.
  const pickRecent = (a: string | null, b: string | null) => {
    if (!a) return b;
    if (!b) return a;
    return new Date(a) > new Date(b) ? a : b;
  };
  const lastVacuum = pickRecent(stats.lastVacuum, stats.lastAutovacuum);
  const lastAnalyze = pickRecent(stats.lastAnalyze, stats.lastAutoanalyze);

  const sections: Array<{
    title: string;
    items: Array<{ label: string; value: React.ReactNode; hint?: string }>;
  }> = [
    {
      title: "Storage",
      items: [
        {
          label: "Row estimate",
          value: stats.analyzed ? (
            formatNumber(stats.rowEstimate)
          ) : (
            <span className="text-muted-foreground/60 italic">—</span>
          ),
          hint: stats.analyzed
            ? "from pg_class.reltuples"
            : "run ANALYZE to populate",
        },
        { label: "Total size", value: formatBytes(stats.totalSize) },
        { label: "Table size", value: formatBytes(stats.tableSize) },
        { label: "Indexes size", value: formatBytes(stats.indexSize) },
        { label: "TOAST size", value: formatBytes(stats.toastSize) },
        {
          label: "Live tuples",
          value: formatNumber(stats.liveTuples),
        },
        {
          label: "Dead tuples",
          value: formatNumber(stats.deadTuples),
          hint:
            stats.deadTuples > stats.liveTuples * 0.2 && stats.liveTuples > 0
              ? "consider VACUUM"
              : undefined,
        },
      ],
    },
    {
      title: "Activity",
      items: [
        { label: "Sequential scans", value: formatNumber(stats.seqScan) },
        { label: "Seq tuples read", value: formatNumber(stats.seqTupRead) },
        { label: "Index scans", value: formatNumber(stats.idxScan) },
        { label: "Idx tuples fetched", value: formatNumber(stats.idxTupFetch) },
        { label: "Inserts", value: formatNumber(stats.nTupIns) },
        { label: "Updates", value: formatNumber(stats.nTupUpd) },
        { label: "Deletes", value: formatNumber(stats.nTupDel) },
        {
          label: "HOT updates",
          value: formatNumber(stats.nTupHotUpd),
          hint:
            stats.nTupUpd > 0
              ? `${Math.round((stats.nTupHotUpd / stats.nTupUpd) * 100)}% of updates`
              : undefined,
        },
      ],
    },
    {
      title: "Maintenance",
      items: [
        {
          label: "Last vacuum",
          value: formatRelative(lastVacuum),
          hint: lastVacuum
            ? `${stats.vacuumCount + stats.autovacuumCount} run${
                stats.vacuumCount + stats.autovacuumCount === 1 ? "" : "s"
              }`
            : "never",
        },
        {
          label: "Last analyze",
          value: formatRelative(lastAnalyze),
          hint: lastAnalyze
            ? `${stats.analyzeCount + stats.autoanalyzeCount} run${
                stats.analyzeCount + stats.autoanalyzeCount === 1 ? "" : "s"
              }`
            : "never",
        },
      ],
    },
    {
      title: "Schema",
      items: [
        {
          label: "Columns",
          value: columnCount === null ? "—" : formatNumber(columnCount),
        },
        {
          label: "Indexes",
          value: indexCount === null ? "—" : formatNumber(indexCount),
        },
      ],
    },
  ];

  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <div key={section.title}>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            {section.title}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {section.items.map((item) => (
              <div
                key={item.label}
                className="rounded-lg border border-border/60 bg-card px-3 py-2.5"
              >
                <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground/80">
                  {item.label}
                </div>
                <div className="mt-1 text-[18px] font-mono text-foreground tabular-nums">
                  {item.value}
                </div>
                {item.hint ? (
                  <div className="text-[10.5px] font-mono text-muted-foreground mt-0.5">
                    {item.hint}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UnsupportedKind({
  title,
  hint,
  showStorageOnly,
  stats,
}: {
  title: string;
  hint: string;
  showStorageOnly?: boolean;
  stats?: TableStats;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <div className="text-[11.5px] font-mono text-muted-foreground mt-0.5">
          {hint}
        </div>
      </div>
      {showStorageOnly && stats ? (
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            Storage
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              ["Total size", formatBytes(stats.totalSize)],
              ["Table size", formatBytes(stats.tableSize)],
              ["Indexes size", formatBytes(stats.indexSize)],
              ["TOAST size", formatBytes(stats.toastSize)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-border/60 bg-card px-3 py-2.5"
              >
                <div className="text-[10.5px] font-mono uppercase tracking-wider text-muted-foreground/80">
                  {label}
                </div>
                <div className="mt-1 text-[18px] font-mono text-foreground tabular-nums">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
