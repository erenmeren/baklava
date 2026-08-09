"use client";

import { Search, Rows3, Rows4, ArrowUp, ArrowDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface GridColumn {
  name: string;
  /** Second line under the header — type, plus " · NOT NULL". */
  hint?: string;
  isPrimaryKey?: boolean;
}
export type GridDensity = "compact" | "normal";
export type GridSort = { column: string; dir: "asc" | "desc" } | null;

/** Case-insensitive substring match across every cell of a row. Pure; exported for tests. */
export function filterRows(rows: unknown[][], query: string): unknown[][] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    row.some((cell) => {
      if (cell == null) return false;
      const text = typeof cell === "object" ? JSON.stringify(cell) : String(cell);
      return text.toLowerCase().includes(q);
    }),
  );
}

export function GridToolbar(props: {
  filter: string;
  onFilterChange: (value: string) => void;
  density: GridDensity;
  onDensityChange: (density: GridDensity) => void;
  /** Free-form status text — row counts, match counts, ranges. */
  status: React.ReactNode;
  /** Right-hand slot: Export / Insert row / Refresh. */
  children?: React.ReactNode;
}): React.ReactElement {
  const { filter, onFilterChange, density, onDensityChange, status, children } = props;
  return (
    <div className="flex flex-wrap items-center gap-2 justify-between sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 -mx-1 px-1 py-1 rounded-md">
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder="Filter rows on this page…"
            className="h-8 w-[260px] pl-7 text-xs font-mono"
            spellCheck={false}
          />
        </div>
        <div className="inline-flex rounded-md border border-border/60 overflow-hidden">
          <button
            type="button"
            onClick={() => onDensityChange("compact")}
            title="Compact rows"
            className={cn(
              "size-8 grid place-items-center transition-colors",
              density === "compact"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Rows4 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDensityChange("normal")}
            title="Normal rows"
            className={cn(
              "size-8 grid place-items-center transition-colors border-l border-border/60",
              density === "normal"
                ? "bg-foreground/10 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Rows3 className="size-3.5" />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
          {status}
        </p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function DataGrid(props: {
  columns: GridColumn[];
  rows: unknown[][];
  density: GridDensity;
  sort?: GridSort;
  onToggleSort?: (column: string) => void;
  rowActions?: (row: unknown[], index: number) => React.ReactNode;
  empty: React.ReactNode;
}): React.ReactElement {
  const { columns, rows, density, sort, onToggleSort, rowActions, empty } = props;
  const cellPad = density === "compact" ? "px-3 py-1" : "px-3 py-2";
  const headPad = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";

  return (
    <div className="rounded-lg border border-border/60 overflow-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead className="bg-muted/60 sticky top-0 z-[1]">
          <tr>
            {columns.map((col) => {
              const sorted = sort?.column === col.name ? sort.dir : null;
              return (
                <th
                  key={col.name}
                  className={cn(
                    "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                    onToggleSort && "cursor-pointer select-none hover:bg-foreground/[0.04]",
                    headPad,
                  )}
                  onClick={onToggleSort ? () => onToggleSort(col.name) : undefined}
                  title={onToggleSort ? "Click to sort" : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    {col.isPrimaryKey ? (
                      <span
                        className="size-1.5 rounded-full bg-brand"
                        title="Primary key"
                        aria-hidden
                      />
                    ) : null}
                    <span className="text-foreground">{col.name}</span>
                    {onToggleSort && sorted === "asc" ? (
                      <ArrowUp className="size-3 text-brand" />
                    ) : onToggleSort && sorted === "desc" ? (
                      <ArrowDown className="size-3 text-brand" />
                    ) : null}
                  </div>
                  <div className="text-[10px] font-normal text-muted-foreground">
                    {col.hint ?? ""}
                  </div>
                </th>
              );
            })}
            {rowActions ? <th className="w-px border-b border-border/60" /> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="group border-b border-border/30 hover:bg-foreground/[0.025]"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn("max-w-[40ch] truncate align-top", cellPad)}
                  title={cell == null ? "null" : String(cell)}
                >
                  {cell === null ? (
                    <span className="text-muted-foreground/50 italic">null</span>
                  ) : typeof cell === "object" ? (
                    <span className="text-brand">{JSON.stringify(cell)}</span>
                  ) : typeof cell === "boolean" ? (
                    <span className="text-brand">{cell ? "true" : "false"}</span>
                  ) : (
                    String(cell)
                  )}
                </td>
              ))}
              {rowActions ? (
                <td className="px-2 py-1 align-top whitespace-nowrap">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {rowActions(row, i)}
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={Math.max(columns.length + (rowActions ? 1 : 0), 1)}
                className="px-3 py-6 text-center text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
