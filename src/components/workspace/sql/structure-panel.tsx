"use client";

import { useState } from "react";
import { Search, Rows3, Rows4 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { SqlColumn } from "./types";

/**
 * The shared Structure tab body for the postgres, mysql and sqlserver table
 * workspaces: filter input, density toggle, counts line, and a wide column
 * table. The Extra column is derived from the data — it shows when any
 * column carries a non-null `extra` (MySQL's `extra` / SQL Server's
 * IDENTITY(…) / computed marker) — never from a caller-passed flag, so the
 * techs that don't have the concept (postgres) can never disagree with it.
 */
export function StructurePanel({
  columns,
  extraChips,
  action,
}: {
  columns: SqlColumn[];
  /** Extra chips per column, after pk / not null / unique — postgres puts FK links here. */
  extraChips?: (column: SqlColumn) => React.ReactNode;
  /** Toolbar action on the right — postgres's "Modify columns". */
  action?: React.ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const [density, setDensity] = useState<"compact" | "normal">("compact");

  const q = filter.trim().toLowerCase();
  const visible = q
    ? columns.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.dataType.toLowerCase().includes(q) ||
          (c.comment ?? "").toLowerCase().includes(q),
      )
    : columns;

  const cellPad = density === "compact" ? "px-3 py-1" : "px-3 py-2";
  const headPad = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";

  const pkCount = columns.filter((c) => c.isPrimaryKey).length;
  const notNullCount = columns.filter((c) => !c.nullable).length;
  const withDefault = columns.filter((c) => c.default !== null).length;
  const showExtra = columns.some((c) => c.extra != null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, type, comment…"
              className="h-8 w-[260px] pl-7 text-xs font-mono"
              spellCheck={false}
            />
          </div>
          <div className="inline-flex rounded-md border border-border/60 overflow-hidden">
            <button
              type="button"
              onClick={() => setDensity("compact")}
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
              onClick={() => setDensity("normal")}
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
            {columns.length} columns · {pkCount} pk · {notNullCount} not null ·{" "}
            {withDefault} with default
            {q ? ` · ${visible.length} match${visible.length === 1 ? "" : "es"}` : ""}
          </p>
        </div>
        {action}
      </div>

      <div className="rounded-lg border border-border/60 overflow-auto">
        <table className="w-full text-xs font-mono border-collapse">
          <thead className="bg-muted/60 sticky top-0 z-[1]">
            <tr>
              <th
                className={cn(
                  "text-right font-semibold border-b border-border/60 whitespace-nowrap w-10 text-muted-foreground",
                  headPad,
                )}
              >
                #
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Name
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Type
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Constraints
              </th>
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Default
              </th>
              {showExtra ? (
                <th
                  className={cn(
                    "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                    headPad,
                  )}
                >
                  Extra
                </th>
              ) : null}
              <th
                className={cn(
                  "text-left font-semibold border-b border-border/60 whitespace-nowrap",
                  headPad,
                )}
              >
                Comment
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const chips = extraChips?.(c);
              const hasChips = Array.isArray(chips) ? chips.length > 0 : chips != null;
              return (
                <tr
                  key={c.name}
                  className="border-b border-border/30 hover:bg-foreground/[0.025]"
                >
                  <td
                    className={cn(
                      "text-right text-muted-foreground tabular-nums align-top",
                      cellPad,
                    )}
                  >
                    {c.position}
                  </td>
                  <td className={cn("align-top", cellPad)}>
                    <div className="flex items-center gap-1.5">
                      {c.isPrimaryKey ? (
                        <span
                          className="size-1.5 rounded-full bg-brand shrink-0"
                          aria-label="primary key"
                          title="primary key"
                        />
                      ) : (
                        <span className="size-1.5 shrink-0" aria-hidden />
                      )}
                      <span className="text-foreground">{c.name}</span>
                    </div>
                  </td>
                  <td
                    className={cn(
                      "text-foreground/90 align-top whitespace-nowrap",
                      cellPad,
                    )}
                  >
                    {c.dataType}
                  </td>
                  <td className={cn("align-top", cellPad)}>
                    <div className="flex flex-wrap items-center gap-1">
                      {c.isPrimaryKey ? <Chip tone="brand">pk</Chip> : null}
                      {!c.nullable ? <Chip tone="muted">not null</Chip> : null}
                      {c.isUnique ? <Chip tone="muted">unique</Chip> : null}
                      {chips}
                      {c.nullable && !c.isPrimaryKey && !c.isUnique && !hasChips ? (
                        <span className="text-muted-foreground/50 italic">
                          —
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td
                    className={cn(
                      "text-muted-foreground align-top max-w-[28ch] truncate",
                      cellPad,
                    )}
                    title={c.default ?? undefined}
                  >
                    {c.default ?? (
                      <span className="text-muted-foreground/50 italic">—</span>
                    )}
                  </td>
                  {showExtra ? (
                    <td
                      className={cn(
                        "text-muted-foreground align-top whitespace-nowrap",
                        cellPad,
                      )}
                    >
                      {c.extra ? (
                        c.extra
                      ) : (
                        <span className="text-muted-foreground/40 italic">—</span>
                      )}
                    </td>
                  ) : null}
                  <td
                    className={cn(
                      "text-muted-foreground align-top max-w-[40ch] truncate",
                      cellPad,
                    )}
                    title={c.comment ?? undefined}
                  >
                    {c.comment ?? (
                      <span className="text-muted-foreground/40 italic">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={showExtra ? 7 : 6}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No columns match “{filter}”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "brand" | "muted" | "link";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-px rounded border text-[10px] uppercase tracking-wider whitespace-nowrap",
        tone === "brand" && "bg-brand/15 text-brand border-brand/40",
        tone === "muted" && "bg-foreground/5 text-foreground/80 border-border",
        tone === "link" &&
          "bg-foreground/5 text-foreground/80 border-border normal-case tracking-normal text-[10.5px]",
      )}
    >
      {children}
    </span>
  );
}
