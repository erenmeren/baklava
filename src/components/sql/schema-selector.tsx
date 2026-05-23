"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Folder, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Tech = "postgres" | "sqlserver";

interface Props {
  tech: Tech;
  connectionId: string;
  db: string;
  value: string | null;
  onChange: (schema: string | null) => void;
  /**
   * "search_path" — Postgres only — selecting sets the value (route hooks
   * include it in queries). "qualifier" — SQL Server — selecting also enables
   * an "insert [name]." button on each row that writes to the editor.
   */
  mode: "search_path" | "qualifier";
  /** Required in qualifier mode — inserts text at the editor's cursor. */
  onInsert?: (text: string) => void;
}

/**
 * Toolbar dropdown listing user schemas for the current database. Postgres
 * gets a real "search_path" semantic; SQL Server's dropdown is a helper for
 * inserting "[schema]." at the cursor (there's no per-query schema concept).
 */
export function SchemaSelector({
  tech,
  connectionId,
  db,
  value,
  onChange,
  mode,
  onInsert,
}: Props) {
  const [items, setItems] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || items) return;
    let cancelled = false;
    fetch(
      `/api/${tech}/${connectionId}/databases/${encodeURIComponent(db)}/schemas`,
      { cache: "no-store" },
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        // Postgres returns [{ name, owner }]; SQL Server returns string[].
        const arr = (data.schemas as unknown[]) ?? [];
        const names = arr
          .map((x) => (typeof x === "string" ? x : (x as { name?: string }).name))
          .filter((n): n is string => typeof n === "string");
        setItems(names);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, items, tech, connectionId, db]);

  const subtitle =
    mode === "search_path" ? "search_path" : "click insert to add [schema].";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={
              mode === "search_path"
                ? "Schema (search_path)"
                : "Schema · click insert to add qualifier"
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input/60 bg-transparent px-2.5 text-xs font-mono transition-colors hover:bg-muted"
          >
            <Folder className="size-3.5 text-muted-foreground" />
            <span
              className={cn(
                "max-w-[160px] truncate",
                value ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {value ?? "default"}
            </span>
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-64 p-1">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Schema · {subtitle}
          </span>
          {value ? (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              clear
            </button>
          ) : null}
        </div>
        {!items ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">(none)</div>
        ) : (
          <ul className="max-h-72 overflow-auto">
            {items.map((name) => {
              const isCurrent = name === value;
              return (
                <li
                  key={name}
                  className={cn(
                    "group/srow flex items-center justify-between gap-1 rounded transition-colors",
                    isCurrent ? "bg-foreground/10" : "hover:bg-foreground/5",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onChange(name);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex flex-1 items-center justify-between gap-2 px-2 py-1 text-xs font-mono text-left",
                      isCurrent ? "text-foreground" : "text-foreground/80",
                    )}
                  >
                    <span className="truncate">{name}</span>
                    {isCurrent ? <Check className="size-3 shrink-0" /> : null}
                  </button>
                  {mode === "qualifier" && onInsert ? (
                    <button
                      type="button"
                      onClick={() => {
                        onInsert(`[${name}].`);
                        setOpen(false);
                      }}
                      title={`Insert [${name}]. at cursor`}
                      className="inline-flex items-center gap-0.5 mr-1 rounded border border-border/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground transition-colors hover:bg-muted hover:text-foreground opacity-0 group-hover/srow:opacity-100"
                    >
                      <Plus className="size-2.5" />
                      insert
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
