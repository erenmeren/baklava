"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkline } from "@/components/workspace/sparkline";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Cpu, Power, ShieldAlert } from "lucide-react";

interface PulseSample {
  at: number;
  underReplicated: number;
  offlinePartitions: number;
  controllerId: number | null;
  brokerCount: number;
}

interface Props {
  connectionId: string;
}

const POLL_MS = 5_000;
const RING_SIZE = 60; // 60 × 5s = 5 min

/**
 * Cluster pulse strip — three sparklines that track the cheapest, most
 * load-bearing Kafka health signals over a 5-minute rolling window:
 *
 *   • Under-replicated partitions — should be 0; a spike means a broker
 *     is unhappy.
 *   • Offline partitions — should be 0; nonzero pages someone.
 *   • Controller flips — count of distinct controller IDs over the
 *     window; should be 1, anything else is controller flapping.
 *
 * No persistence. Lost on tab close. That's the contract.
 */
export function ClusterPulse({ connectionId }: Props) {
  const [samples, setSamples] = useState<PulseSample[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/kafka/${connectionId}/pulse`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!aliveRef.current) return;
        if (!res.ok || data.error) {
          setErr(data.error ?? `HTTP ${res.status}`);
          return;
        }
        setErr(null);
        setSamples((prev) => {
          const next = [...prev, data as PulseSample];
          if (next.length > RING_SIZE) next.splice(0, next.length - RING_SIZE);
          return next;
        });
      } catch (e) {
        if (aliveRef.current) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(id);
    };
  }, [connectionId]);

  const urpSeries = samples.map((s) => s.underReplicated);
  const offlineSeries = samples.map((s) => s.offlinePartitions);
  const controllers = new Set(
    samples.map((s) => s.controllerId).filter((v): v is number => v != null),
  );
  const flipping = controllers.size > 1;

  const latest = samples[samples.length - 1];
  const urpNow = latest?.underReplicated ?? 0;
  const offlineNow = latest?.offlinePartitions ?? 0;

  const minutes = Math.min(
    Math.ceil((samples.length * POLL_MS) / 60_000),
    Math.ceil((RING_SIZE * POLL_MS) / 60_000),
  );

  return (
    <section className="rounded-lg border border-border/60 bg-card/40">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {urpNow === 0 && offlineNow === 0 && !flipping ? (
            <CheckCircle2 className="size-3.5 text-emerald-500" />
          ) : (
            <AlertTriangle className="size-3.5 text-amber-500" />
          )}
          Cluster pulse
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          last {minutes}m · live, lost on refresh
        </div>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border/40">
        <PulseTile
          icon={<ShieldAlert className="size-3.5" />}
          label="Under-replicated"
          value={urpNow}
          tone={urpNow > 0 ? "warn" : "ok"}
          series={urpSeries}
          sparkTone="neutral"
        />
        <PulseTile
          icon={<Power className="size-3.5" />}
          label="Offline partitions"
          value={offlineNow}
          tone={offlineNow > 0 ? "danger" : "ok"}
          series={offlineSeries}
          sparkTone="neutral"
        />
        <ControllerTile
          controllerId={latest?.controllerId ?? null}
          brokers={latest?.brokerCount ?? 0}
          flipping={flipping}
          history={[...controllers]}
        />
      </div>
      {err ? (
        <div className="border-t border-border/60 px-4 py-1.5 text-[10px] font-mono text-amber-600 dark:text-amber-400">
          pulse stale · {err}
        </div>
      ) : null}
    </section>
  );
}

function PulseTile({
  icon,
  label,
  value,
  tone,
  series,
  sparkTone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "ok" | "warn" | "danger";
  series: number[];
  sparkTone: "neutral" | "lag";
}) {
  return (
    <div
      className={cn(
        "px-4 py-3 bg-card/40",
        tone === "danger" && "bg-rose-500/5",
        tone === "warn" && "bg-amber-500/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {icon}
          {label}
        </div>
        <Sparkline
          values={series}
          tone={sparkTone}
          width={88}
          height={20}
          className={cn(
            tone === "ok" && "text-emerald-500",
            tone === "warn" && "text-amber-500",
            tone === "danger" && "text-rose-500",
          )}
          ariaLabel={`${label} last samples`}
        />
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl tabular-nums",
          tone === "ok" && "text-foreground/90",
          tone === "warn" && "text-amber-700 dark:text-amber-400",
          tone === "danger" && "text-rose-700 dark:text-rose-400",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ControllerTile({
  controllerId,
  brokers,
  flipping,
  history,
}: {
  controllerId: number | null;
  brokers: number;
  flipping: boolean;
  history: number[];
}) {
  return (
    <div
      className={cn(
        "px-4 py-3 bg-card/40",
        flipping && "bg-rose-500/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          <Cpu className="size-3.5" />
          Controller
        </div>
        <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {brokers} broker{brokers === 1 ? "" : "s"}
        </div>
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl tabular-nums",
          flipping
            ? "text-rose-700 dark:text-rose-400"
            : "text-foreground/90",
        )}
      >
        {controllerId == null ? "—" : `#${controllerId}`}
      </div>
      <div
        className={cn(
          "mt-0.5 text-[10px] font-mono uppercase tracking-wider",
          flipping ? "text-rose-600" : "text-muted-foreground/60",
        )}
      >
        {flipping
          ? `flapping · seen ${history.join(", ")}`
          : "stable"}
      </div>
    </div>
  );
}
