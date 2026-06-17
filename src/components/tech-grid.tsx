"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TECH_CATALOG,
  TECH_CATEGORIES,
  techIconUrl,
  type TechCategoryFilter,
  type TechMeta,
} from "@/lib/tech-catalog";
import type { ConnectionRecord } from "@/lib/connections/types";
import { ConnectionSheet } from "@/components/connection-sheet";
import { InstallDriverDialog } from "@/components/install-driver-dialog";
import { cn } from "@/lib/utils";

interface ConnectionsResponse {
  connections: ConnectionRecord[];
}

export function TechGrid({
  installed = {},
  optionalDeps = {},
  canInstall = false,
}: {
  installed?: Record<string, boolean>;
  optionalDeps?: Record<string, string[]>;
  canInstall?: boolean;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<TechCategoryFilter>("All");
  const [openTech, setOpenTech] = useState<TechMeta | null>(null);
  const [installTech, setInstallTech] = useState<TechMeta | null>(null);
  const router = useRouter();

  const handleInstallOpenChange = useCallback((o: boolean) => {
    if (!o) setInstallTech(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [connRes, ltRes] = await Promise.all([
          fetch("/api/connections", { cache: "no-store" }).catch(() => null),
          fetch("/api/loadtest", { cache: "no-store" }).catch(() => null),
        ]);
        if (cancelled) return;
        const next: Record<string, number> = {};
        if (connRes?.ok) {
          const data = (await connRes.json()) as ConnectionsResponse;
          for (const c of data.connections) {
            next[c.tech] = (next[c.tech] ?? 0) + 1;
          }
        }
        if (ltRes?.ok) {
          const ltData = (await ltRes.json()) as { loadtests: unknown[] };
          next.loadtest = ltData.loadtests.length;
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
          // Genuinely-unbuilt techs get a "soon" badge; ones that are built
          // but switched off in this build just appear dimmed.
          const isComingSoon = tech.status === "coming-soon";
          // Only connection techs (not tools) can have missing drivers.
          // installed[id] === undefined means we have no info → treat as installed.
          const driverMissing =
            tech.kind !== "tool" &&
            isAvailable &&
            installed[tech.id] === false;

          const tile = (
            <div
              className={cn(
                "group relative aspect-square rounded-xl border border-border bg-card p-5",
                "flex flex-col items-center justify-center gap-3 text-center",
                isAvailable && !driverMissing
                  ? "tile-neon hover:border-border/80 cursor-pointer"
                  : "opacity-55 transition-opacity",
              )}
            >
              <span
                className={cn(
                  "absolute top-3 right-3 inline-flex items-center gap-1 font-mono text-[10px] leading-none",
                  isAvailable && !driverMissing
                    ? count > 0
                      ? "text-brand"
                      : "text-muted-foreground/60"
                    : "text-muted-foreground/70 px-1.5 py-1 rounded-full border border-border bg-muted uppercase tracking-wider",
                )}
              >
                {isAvailable && !driverMissing ? (
                  count > 0 ? (
                    <>
                      <span className="size-1.5 rounded-full bg-brand status-pulse" />
                      {count}
                    </>
                  ) : null
                ) : isComingSoon ? (
                  "soon"
                ) : driverMissing ? (
                  "no driver"
                ) : null}
              </span>

              <div className="size-20 grid place-items-center transition-transform duration-200 group-hover:scale-105">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={techIconUrl(tech)}
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

              {driverMissing && (
                <div className="flex flex-col items-center gap-1.5">
                  <p className="text-[10.5px] text-muted-foreground/80 leading-tight">
                    needs: {(optionalDeps[tech.id] ?? []).join(", ")}
                  </p>
                  {canInstall ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInstallTech(tech);
                      }}
                      className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/20 transition-colors"
                    >
                      Install driver
                    </button>
                  ) : (
                    <code className="text-[10px] text-muted-foreground/70 select-all">
                      npm i {(optionalDeps[tech.id] ?? []).join(" ")}
                    </code>
                  )}
                </div>
              )}
            </div>
          );

          return isAvailable && !driverMissing ? (
            <button
              key={tech.id}
              type="button"
              onClick={() => (tech.kind === "tool" ? router.push("/loadtest") : setOpenTech(tech))}
              aria-label={`Open ${tech.name} connections`}
              className="rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {tile}
            </button>
          ) : (
            <div
              key={tech.id}
              aria-disabled
              title={
                driverMissing
                  ? `${tech.name} — driver not installed`
                  : `${tech.name} — ${isComingSoon ? "coming soon" : "not enabled in this build"}`
              }
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
      <InstallDriverDialog
        techId={installTech?.id ?? null}
        techName={installTech?.name ?? ""}
        open={installTech !== null}
        onOpenChange={handleInstallOpenChange}
      />
    </div>
  );
}
