"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TECH_CATALOG } from "@/lib/tech-catalog";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight } from "lucide-react";
import type { ConnectionRecord, TechId } from "@/lib/connections/types";

interface ConnectionsResponse {
  connections: ConnectionRecord[];
}

export function TechGrid() {
  const [counts, setCounts] = useState<Record<TechId, number>>({
    docker: 0,
    kafka: 0,
    postgres: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/connections", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ConnectionsResponse;
        if (cancelled) return;
        const next: Record<TechId, number> = {
          docker: 0,
          kafka: 0,
          postgres: 0,
        };
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

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {TECH_CATALOG.map((tech, i) => {
        const Icon = tech.icon;
        const count = counts[tech.id];
        return (
          <Link
            key={tech.id}
            href={`/${tech.id}`}
            className="reveal-up group focus:outline-none"
            style={{ ["--delay" as string]: `${360 + i * 80}ms` }}
          >
            <div
              className="layered-card relative h-full p-6 rounded-xl border border-border bg-card
                         transition-all duration-300
                         group-hover:-translate-y-0.5 group-hover:border-brand/40
                         group-focus-visible:border-brand/60 group-focus-visible:ring-2 group-focus-visible:ring-brand/30
                         flex flex-col gap-5"
            >
              <div className="flex items-start justify-between">
                <div
                  className={`relative inline-flex items-center justify-center size-12 rounded-xl bg-gradient-to-br ${tech.color} text-white shadow-sm shadow-black/10 ring-1 ring-white/15`}
                >
                  <Icon className="size-6" />
                </div>
                {count > 0 ? (
                  <Badge
                    variant="secondary"
                    className="font-mono text-[10px] gap-1 bg-brand-muted text-brand-foreground border-brand/20"
                  >
                    <span className="size-1 rounded-full bg-brand status-pulse" />
                    {count} active
                  </Badge>
                ) : (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
                    no connections
                  </span>
                )}
              </div>

              <div className="space-y-1.5 flex-1">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-lg font-semibold tracking-tight">
                    {tech.name}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    {tech.tagline}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {tech.description}
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/60">
                <span className="text-sm text-foreground/80 group-hover:text-brand transition-colors">
                  Open console
                </span>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-brand group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
