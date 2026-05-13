"use client";

import { useEffect, useMemo, useState } from "react";
import {
  TECH_CATALOG,
  TECH_CATEGORIES,
  type TechCategoryFilter,
  type TechMeta,
} from "@/lib/tech-catalog";
import type { ConnectionRecord } from "@/lib/connections/types";
import { ConnectionSheet } from "@/components/connection-sheet";
import { cn } from "@/lib/utils";

interface ConnectionsResponse {
  connections: ConnectionRecord[];
}

export function TechGrid() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<TechCategoryFilter>("All");
  const [openTech, setOpenTech] = useState<TechMeta | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/connections", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ConnectionsResponse;
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const c of data.connections) {
          next[c.tech] = (next[c.tech] ?? 0) + 1;
        }
        setCounts(next);
      } catch {
        // ignore
      }
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = { All: TECH_CATALOG.length };
    for (const t of TECH_CATALOG) c[t.category] = (c[t.category] ?? 0) + 1;
    return c;
  }, []);

  const visible = useMemo(
    () =>
      filter === "All"
        ? TECH_CATALOG
        : TECH_CATALOG.filter((t) => t.category === filter),
    [filter],
  );

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        className="flex flex-wrap items-center gap-x-7 gap-y-1 border-b border-border/60"
      >
        {TECH_CATEGORIES.map((c) => {
          const active = filter === c;
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(c)}
              className={cn(
                "relative inline-flex items-center gap-2 py-3.5 text-[13.5px] font-medium tracking-tight transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
              <span
                className={cn(
                  "font-mono text-[10.5px] px-1.5 py-px rounded-full border min-w-[20px] text-center transition-colors",
                  active
                    ? "border-brand/40 bg-brand/10 text-brand"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {categoryCounts[c] ?? 0}
              </span>
              {active && (
                <span className="absolute left-0 right-0 -bottom-px h-[2px] rounded-t-sm bg-brand" />
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {visible.map((tech) => {
          const count = counts[tech.id] ?? 0;
          const isAvailable = tech.status === "available";

          const tile = (
            <div
              className={cn(
                "group relative aspect-square rounded-xl border border-border bg-card p-5",
                "flex flex-col items-center justify-center gap-3 text-center",
                isAvailable
                  ? "tile-neon hover:border-border/80 cursor-pointer"
                  : "opacity-55 transition-opacity",
              )}
            >
              <span
                className={cn(
                  "absolute top-3 right-3 inline-flex items-center gap-1 font-mono text-[10px] leading-none",
                  isAvailable
                    ? count > 0
                      ? "text-brand"
                      : "text-muted-foreground/60"
                    : "text-muted-foreground/70 px-1.5 py-1 rounded-full border border-border bg-muted uppercase tracking-wider",
                )}
              >
                {isAvailable ? (
                  count > 0 ? (
                    <>
                      <span className="size-1.5 rounded-full bg-brand status-pulse" />
                      {count}
                    </>
                  ) : null
                ) : (
                  "soon"
                )}
              </span>

              <div className="size-20 grid place-items-center transition-transform duration-200 group-hover:scale-105">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://cdn.simpleicons.org/${tech.slug}`}
                  alt=""
                  width={64}
                  height={64}
                  draggable={false}
                  aria-hidden
                  className="size-16 select-none dark:brightness-0 dark:invert"
                />
              </div>

              <h3 className="text-[15px] font-medium tracking-tight">
                {tech.name}
              </h3>
            </div>
          );

          return isAvailable ? (
            <button
              key={tech.id}
              type="button"
              onClick={() => setOpenTech(tech)}
              aria-label={`Open ${tech.name} connections`}
              className="rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {tile}
            </button>
          ) : (
            <div
              key={tech.id}
              aria-disabled
              title={`${tech.name} — coming soon`}
              className="cursor-not-allowed"
            >
              {tile}
            </div>
          );
        })}
      </div>

      <ConnectionSheet
        tech={openTech}
        onOpenChange={(o) => {
          if (!o) setOpenTech(null);
        }}
      />
    </div>
  );
}
