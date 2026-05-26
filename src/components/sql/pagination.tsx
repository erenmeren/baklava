"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared pagination control for SQL Server / Postgres table data and query
 * result panels. Two modes share the same UI:
 *
 * - Server-paged (table data): caller wires `onOffsetChange` to refetch with
 *   the new offset and `onPageSizeChange` to refetch with the new limit.
 * - Client-paged (query result panels): caller slices an in-memory array by
 *   `[offset, offset+pageSize)`; `total` is `rows.length`.
 *
 * `total === null` means "unknown" — first/last and the page-of-N indicator
 * are hidden, prev/next stay live until the page comes back short.
 */

const DEFAULT_SIZES = [25, 50, 100, 250, 500] as const;

interface Props {
  offset: number;
  pageSize: number;
  total: number | null;
  loading?: boolean;
  onOffsetChange: (offset: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Override the page-size dropdown options (omit "All" — too dangerous on big tables). */
  pageSizes?: readonly number[];
  className?: string;
}

export function DataPagination({
  offset,
  pageSize,
  total,
  loading,
  onOffsetChange,
  onPageSizeChange,
  pageSizes = DEFAULT_SIZES,
  className,
}: Props) {
  const knownTotal = total != null;
  const empty = total === 0;

  const showingFrom = empty ? 0 : offset + 1;
  const showingTo = knownTotal
    ? Math.min(offset + pageSize, total)
    : offset + pageSize;

  const totalPages = knownTotal
    ? Math.max(1, Math.ceil((total || 1) / pageSize))
    : null;
  const currentPage = Math.floor(offset / pageSize) + 1;

  const atStart = offset <= 0;
  const atEnd = knownTotal ? offset + pageSize >= total : false;

  // Make sure offset never lands negative.
  const go = (next: number) => onOffsetChange(Math.max(0, next));

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-xs font-mono text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="tabular-nums truncate">
          {empty ? (
            <span>0 rows</span>
          ) : knownTotal ? (
            <>
              <span className="text-foreground/80">
                {showingFrom.toLocaleString()}
              </span>
              <span className="px-1 text-muted-foreground/50">–</span>
              <span className="text-foreground/80">
                {showingTo.toLocaleString()}
              </span>
              <span className="px-1 text-muted-foreground/60">of</span>
              <span className="text-foreground/80">
                {total.toLocaleString()}
              </span>
            </>
          ) : (
            <>
              <span className="text-foreground/80">
                {showingFrom.toLocaleString()}
              </span>
              <span className="px-1 text-muted-foreground/50">–</span>
              <span className="text-foreground/80">
                {showingTo.toLocaleString()}
              </span>
            </>
          )}
        </span>

        {onPageSizeChange ? (
          <>
            <span className="text-muted-foreground/40" aria-hidden>
              ·
            </span>
            <label className="flex items-center gap-1 cursor-pointer">
              <select
                value={pageSize}
                disabled={loading}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next) && next > 0) onPageSizeChange(next);
                }}
                className={cn(
                  "appearance-none bg-transparent border border-border/60 rounded px-1.5 py-0.5",
                  "font-mono text-[11px] text-foreground/80 tabular-nums",
                  "hover:border-border focus:outline-none focus:border-foreground/40",
                  "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
                  "transition-colors",
                )}
                aria-label="Rows per page"
              >
                {pageSizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground/70 text-[11px]">
                / page
              </span>
            </label>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-1 shrink-0 tabular-nums">
        {totalPages != null ? (
          <Button
            size="icon"
            variant="outline"
            className="size-7"
            disabled={atStart || loading}
            onClick={() => go(0)}
            title="First page"
            aria-label="First page"
          >
            <ChevronsLeft className="size-3.5" />
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="outline"
          className="size-7"
          disabled={atStart || loading}
          onClick={() => go(offset - pageSize)}
          title="Previous page"
          aria-label="Previous page"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="px-2 select-none">
          <span className="text-foreground/90">{currentPage}</span>
          {totalPages != null ? (
            <span className="text-muted-foreground/60">
              {" "}
              / {totalPages.toLocaleString()}
            </span>
          ) : null}
        </span>
        <Button
          size="icon"
          variant="outline"
          className="size-7"
          disabled={atEnd || loading}
          onClick={() => go(offset + pageSize)}
          title="Next page"
          aria-label="Next page"
        >
          <ChevronRight className="size-3.5" />
        </Button>
        {totalPages != null ? (
          <Button
            size="icon"
            variant="outline"
            className="size-7"
            disabled={atEnd || loading}
            onClick={() => go((totalPages - 1) * pageSize)}
            title="Last page"
            aria-label="Last page"
          >
            <ChevronsRight className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
