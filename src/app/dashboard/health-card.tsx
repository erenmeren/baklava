"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { workspaceHref } from "@/lib/connections/first-page";
import type { ConnectionRecord } from "@/lib/connections/types";
import type { HealthSnapshot, HealthStatus } from "@/lib/connections/health";
import { Sparkline } from "./sparkline";

const POLL_MS = 5000;
const HISTORY = 30;

const DOT: Record<HealthStatus, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-destructive",
};
const RING: Record<HealthStatus, string> = {
  ok: "text-emerald-500",
  degraded: "text-amber-500",
  down: "text-destructive",
};

export function HealthCard({
  conn,
  onStatus,
}: {
  conn: ConnectionRecord;
  onStatus: (id: string, status: HealthStatus | null) => void;
}) {
  const router = useRouter();
  const [snap, setSnap] = useState<HealthSnapshot | null>(null);
  const [historyData, setHistoryData] = useState<number[]>([]);
  const historyRef = useRef<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;

    const tick = async () => {
      if (document.hidden) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`/api/dashboard/${conn.id}/health`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!active) return;
        const data = (await res.json()) as HealthSnapshot;
        if (data.primary) {
          const next = [...historyRef.current, data.primary.value].slice(-HISTORY);
          historyRef.current = next;
          setHistoryData(next);
        }
        setSnap(data);
        onStatus(conn.id, data.status);
      } catch (err) {
        // A self-abort (the next tick cancelling a slow in-flight probe) or an
        // unmount isn't a real failure — don't flash the card "down".
        if (!active || (err instanceof DOMException && err.name === "AbortError")) return;
        onStatus(conn.id, "down");
        setSnap((s) => (s ? { ...s, status: "down" } : s));
      }
    };

    tick();
    const interval = setInterval(tick, POLL_MS);
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      active = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
      onStatus(conn.id, null);
    };
  }, [conn.id, onStatus]);

  const status = snap?.status;
  const down = status === "down";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => router.push(workspaceHref(conn.tech, conn.id))}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(workspaceHref(conn.tech, conn.id));
        }
      }}
      className="cursor-pointer gap-3 p-4 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/icons/${conn.tech}.svg`} alt="" className="size-4 opacity-80 dark:brightness-0 dark:invert" />
        <span className="truncate text-sm font-medium">{conn.name}</span>
        <span
          className={cn("ml-auto size-2 rounded-full", status ? DOT[status] : "bg-muted-foreground/40 animate-pulse")}
          title={status ?? "checking…"}
        />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">
            {snap ? (down ? snap.error ?? "Unreachable" : snap.summary) : "Checking…"}
          </p>
          {snap?.metrics.length ? (
            <p className="mt-1 truncate font-mono text-xs tabular-nums">
              {snap.metrics.map((m) => `${m.label} ${m.value}`).join("  ·  ")}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <Sparkline
            data={historyData}
            muted={down}
            className={cn("h-6 w-24", status ? RING[status] : "text-muted-foreground")}
          />
          {snap ? (
            <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
              {down ? "—" : `${snap.latencyMs}ms`}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
