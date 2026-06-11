"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import type { ConnectionRecord } from "@/lib/connections/types";
import type { HealthStatus } from "@/lib/connections/health";
import { Card } from "@/components/ui/card";
import { HealthCard } from "./health-card";

export function DashboardClient() {
  const [conns, setConns] = useState<ConnectionRecord[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, HealthStatus>>({});

  useEffect(() => {
    fetch("/api/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { connections?: ConnectionRecord[] }) => setConns(d.connections ?? []))
      .catch(() => setConns([]));
  }, []);

  const onStatus = useCallback((id: string, status: HealthStatus | null) => {
    setStatuses((prev) => {
      if (status === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      if (prev[id] === status) return prev;
      return { ...prev, [id]: status };
    });
  }, []);

  const values = Object.values(statuses);
  const healthy = values.filter((s) => s === "ok").length;
  const degraded = values.filter((s) => s === "degraded").length;
  const down = values.filter((s) => s === "down").length;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pt-10 pb-24">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <LayoutDashboard className="size-5 text-muted-foreground" />
            Dashboard
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Live health across every connection. Click a card to open its workspace.
          </p>
        </div>
        {values.length ? (
          <div className="flex shrink-0 items-center gap-4 font-mono text-xs tabular-nums">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />{healthy}</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" />{degraded}</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-destructive" />{down}</span>
          </div>
        ) : null}
      </header>

      {conns === null ? (
        <p className="text-sm text-muted-foreground">Loading connections…</p>
      ) : conns.length === 0 ? (
        <Card className="items-center p-12 text-center">
          <p className="text-sm font-medium">No connections yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add one from the <Link href="/" className="underline underline-offset-4">home screen</Link> to see it here.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {conns.map((c) => (
            <HealthCard key={c.id} conn={c} onStatus={onStatus} />
          ))}
        </div>
      )}
    </div>
  );
}
