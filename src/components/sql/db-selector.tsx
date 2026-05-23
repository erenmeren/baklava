"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ChevronDown, Database } from "lucide-react";
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
  currentDb: string;
}

/**
 * Toolbar dropdown listing the connection's databases. Picking one navigates
 * to that database's /query route, which redirects to a fresh queryId — i.e.
 * opens a clean query tab against the chosen DB. The current tab's saved
 * SQL/history is keyed by (connection, db, queryId) and is untouched, so
 * switching back keeps it intact.
 */
export function DbSelector({ tech, connectionId, currentDb }: Props) {
  const [items, setItems] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || items) return;
    let cancelled = false;
    fetch(`/api/${tech}/${connectionId}/databases`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const arr = (d.databases as Array<{ name: string }> | undefined) ?? [];
        setItems(arr.map((x) => x.name));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, items, tech, connectionId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Switch database"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input/60 bg-transparent px-2.5 text-xs font-mono text-foreground transition-colors hover:bg-muted"
          >
            <Database className="size-3.5 text-muted-foreground" />
            <span className="max-w-[180px] truncate">{currentDb}</span>
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-60 p-1">
        <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Switch database
        </div>
        {!items ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">(none)</div>
        ) : (
          <ul className="max-h-64 overflow-auto">
            {items.map((name) => {
              const isCurrent = name === currentDb;
              const href = `/${tech}/${connectionId}/databases/${encodeURIComponent(name)}/query`;
              return (
                <li key={name}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded px-2 py-1 text-xs font-mono transition-colors",
                      isCurrent
                        ? "bg-foreground/10 text-foreground"
                        : "text-foreground/80 hover:bg-foreground/5",
                    )}
                    title={isCurrent ? "Current database" : `Open new query in ${name}`}
                  >
                    <span className="truncate">{name}</span>
                    {isCurrent ? <Check className="size-3 shrink-0" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border/40 px-2 py-1 text-[10px] text-muted-foreground">
          opens a new query tab
        </div>
      </PopoverContent>
    </Popover>
  );
}
