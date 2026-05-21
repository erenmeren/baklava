"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Canonical per-partition "heatmap cell". Square tile, partition index on top,
// a compact count below, color ramped emerald → amber → red by `intensity`
// (0..1), a pulsing brand dot when owned, and a red glow on the heaviest tile.
// Originally lived inline in the consumer-group detail page; extracted here so
// the consumer-groups list expansion and the topic Partitions tab share one
// look. Callers compute `intensity` (lag-relative, volume-relative, …) and
// pre-format `countLabel`, so the cell stays metric-agnostic.

export interface PartitionCellData {
  partition: number;
  /** 0..1 severity that drives the color ramp and the heaviest-glow. */
  intensity: number;
  /** Small number under the partition index, already compact-formatted. */
  countLabel?: string;
  /** No data on this partition (no messages produced / unknown) → muted tile. */
  idle?: boolean;
  /** Owner client id — renders a pulsing dot in the corner when present. */
  owner?: string;
  /** Optional deep-link; renders the tile as a Link instead of a div. */
  href?: string;
  /** Same-page click handler; renders the tile as a button (takes precedence
   *  over `href`). Use for in-page navigation that shouldn't round-trip the URL. */
  onClick?: () => void;
  /** Full multi-line tooltip. */
  tooltip?: string;
}

export function PartitionCell({ data }: { data: PartitionCellData }) {
  const { partition, intensity, countLabel, idle, owner, href, onClick, tooltip } =
    data;

  const bg = idle
    ? "bg-muted/30 border-border/40"
    : intensity === 0
      ? "bg-emerald-500/15 border-emerald-500/30 hover:bg-emerald-500/25"
      : intensity < 0.25
        ? "bg-amber-500/15 border-amber-500/30 hover:bg-amber-500/25"
        : intensity < 0.6
          ? "bg-amber-500/30 border-amber-500/50 hover:bg-amber-500/40"
          : "bg-red-500/30 border-red-500/50 hover:bg-red-500/45";

  const heaviest = intensity >= 0.95 && !idle;

  const className = cn(
    "group/cell relative aspect-square rounded-md border",
    "flex flex-col items-center justify-center gap-0.5 transition-all duration-150",
    bg,
    heaviest &&
      "ring-1 ring-red-500/70 shadow-[0_0_10px_-2px_rgba(239,68,68,0.5)]",
  );

  const inner = (
    <>
      <span
        className={cn(
          "font-mono text-[11px] font-semibold tabular-nums leading-none",
          idle && "text-muted-foreground",
        )}
      >
        {partition}
      </span>
      {countLabel ? (
        <span
          className={cn(
            "font-mono text-[9px] tabular-nums leading-none",
            heaviest
              ? "font-semibold text-red-700 dark:text-red-300"
              : "text-muted-foreground",
          )}
        >
          {countLabel}
        </span>
      ) : (
        <span className="text-[9px] text-muted-foreground/40">·</span>
      )}
      {owner ? (
        <span
          aria-hidden
          className="status-pulse absolute bottom-0.5 right-0.5 size-1 rounded-full bg-brand"
        />
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={tooltip} className={className}>
        {inner}
      </button>
    );
  }
  return href ? (
    <Link href={href} title={tooltip} className={className}>
      {inner}
    </Link>
  ) : (
    <div title={tooltip} className={className}>
      {inner}
    </div>
  );
}

/** Auto-filling grid of square cells, matched to the canonical 46px tile. */
export function PartitionHeatmapGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(46px, 1fr))" }}
    >
      {children}
    </div>
  );
}

/** Small emerald→amber→red gradient legend used above a heatmap grid. */
export function HeatLegend({
  low,
  high,
  title,
}: {
  low: string;
  high: string;
  title?: string;
}) {
  return (
    <div
      className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground"
      title={title}
    >
      <span>{low}</span>
      <span
        aria-hidden
        className="h-2 w-20 rounded-full"
        style={{
          background:
            "linear-gradient(90deg, rgba(16,185,129,0.3), rgba(245,158,11,0.75), rgba(239,68,68,0.95))",
        }}
      />
      <span className="tabular-nums">{high}</span>
    </div>
  );
}

/** Compact count formatter shared by heatmap callers (1.2k, 3.4M, 1.0B). */
export function formatPartitionCount(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  if (n < 1_000_000_000)
    return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + "M";
  return (n / 1_000_000_000).toFixed(1) + "B";
}
