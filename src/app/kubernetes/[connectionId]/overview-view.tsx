"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, Box, CheckCircle2, Cpu, MemoryStick, Server } from "lucide-react";
import { Sparkline } from "@/components/workspace/sparkline";
import { cn } from "@/lib/utils";
import { formatAge } from "@/lib/kubernetes/row-types";
import { formatCpu, formatMemory, percentOf } from "@/lib/kubernetes/usage";
import { appendSamples, historyMinutes, type History } from "@/lib/kubernetes/usage-history";
import type { AttentionItem } from "@/lib/kubernetes/overview";
import type { ClusterOverviewResult } from "@/lib/connections/kubernetes/overview";
import { useK8s } from "./k8s-context";

type Tone = "ok" | "warn" | "alert" | "neutral";

const SAMPLE_MS = 5_000; // the shell's refresh cadence

const valueTone: Record<Tone, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-600 dark:text-amber-400",
  alert: "text-red-600 dark:text-red-400",
  neutral: "text-sky-300",
};
const ringTone: Record<Tone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/[0.03]",
  warn: "border-amber-500/50 bg-amber-500/[0.04]",
  alert: "border-red-500/50 bg-red-500/[0.05]",
  neutral: "border-border/60 bg-card/40",
};

function pctTone(p: number | null): Tone {
  if (p === null) return "neutral";
  return p >= 85 ? "alert" : p >= 60 ? "warn" : "ok";
}

/**
 * Cluster overview — one glance at whether anything needs a human. The page
 * re-renders on the shell's 5s refresh; each render adds one usage sample to
 * the in-browser history behind the sparklines.
 */
export function OverviewView({ overview: o }: { overview: ClusterOverviewResult }) {
  const { connectionId, context, serverVersion } = useK8s();
  const base = `/kubernetes/${connectionId}`;
  const nsQuery = `ns=${encodeURIComponent(o.namespace)}`;

  const cpuPct = o.usage ? percentOf(o.usage.cpuMillicores, o.usage.cpuAllocatable) : null;
  const memPct = o.usage ? percentOf(o.usage.memBytes, o.usage.memAllocatable) : null;

  const [history, setHistory] = useState<History>({});
  const [samples, setSamples] = useState(0);
  useEffect(() => {
    setHistory((h) => appendSamples(h, { cpu: cpuPct, mem: memPct }));
    setSamples((n) => n + 1);
  }, [o, cpuPct, memPct]);

  const noteFor = (section: string) => o.notes.find((n) => n.section === section)?.error;
  const nodesTone: Tone = !o.nodes ? "neutral" : o.nodes.ready < o.nodes.total ? "alert" : "ok";
  const attentionTone: Tone = o.attention.length ? "warn" : "ok";

  return (
    <div className="h-full overflow-auto">
      <div className="space-y-5 p-4 font-mono">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi icon={Server} label="Cluster" value={serverVersion} sub={context} tone="neutral" />
          <Kpi
            icon={Server}
            label="Nodes ready"
            value={o.nodes ? `${o.nodes.ready}/${o.nodes.total}` : "—"}
            sub={o.nodes ? "kubelet Ready" : "not visible"}
            tone={nodesTone}
          />
          <Kpi
            icon={Box}
            label="Pods running"
            value={o.pods ? `${o.pods.Running}/${o.pods.total}` : "—"}
            sub={o.namespace === "*" ? "all namespaces" : `ns ${o.namespace}`}
            tone="neutral"
          />
          <Kpi
            icon={AlertTriangle}
            label="Attention"
            value={String(o.attention.length)}
            sub={o.attention.length ? "items need a look" : "all clear"}
            tone={attentionTone}
          />
          <Kpi
            icon={Cpu}
            label="CPU"
            value={cpuPct === null ? "—" : `${cpuPct}%`}
            sub={o.usage ? `${formatCpu(o.usage.cpuMillicores)} / ${formatCpu(o.usage.cpuAllocatable)}` : "no metrics"}
            tone={pctTone(cpuPct)}
            bar={cpuPct}
          />
          <Kpi
            icon={MemoryStick}
            label="Memory"
            value={memPct === null ? "—" : `${memPct}%`}
            sub={o.usage ? `${formatMemory(o.usage.memBytes)} / ${formatMemory(o.usage.memAllocatable)}` : "no metrics"}
            tone={pctTone(memPct)}
            bar={memPct}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card
            title="Pods by phase"
            right={o.namespace === "*" ? "all namespaces" : `ns ${o.namespace}`}
            note={noteFor("pods")}
          >
            {o.pods ? (
              <div className="grid grid-cols-4 gap-px bg-border/40">
                {(
                  [
                    ["Running", "ok"],
                    ["Pending", o.pods.Pending ? "warn" : "neutral"],
                    ["Failed", o.pods.Failed ? "alert" : "neutral"],
                    ["Succeeded", "neutral"],
                  ] as const
                ).map(([phase, tone]) => (
                  <Link
                    key={phase}
                    href={`${base}/pods?${nsQuery}`}
                    className="bg-card/40 px-3 py-2.5 hover:bg-foreground/[0.03]"
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{phase}</div>
                    <div className={cn("mt-1 text-xl tabular-nums neon-text", valueTone[tone])}>{o.pods![phase]}</div>
                  </Link>
                ))}
              </div>
            ) : null}
          </Card>

          <Card
            title="Cluster usage"
            right={`last ${historyMinutes(Math.min(samples, 60), SAMPLE_MS)}m · live, lost on refresh`}
            note={noteFor("metrics")}
          >
            {o.metricsMissing ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                metrics-server not installed — usage needs the metrics.k8s.io API.
              </div>
            ) : o.usage ? (
              <div className="grid grid-cols-2 gap-px bg-border/40">
                {(
                  [
                    ["CPU", cpuPct, history.cpu],
                    ["Memory", memPct, history.mem],
                  ] as const
                ).map(([label, pct, series]) => (
                  <div key={label} className="bg-card/40 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
                      <Sparkline
                        values={series ?? []}
                        width={120}
                        height={22}
                        className={cn(pctTone(pct) === "alert" ? "text-red-500" : pctTone(pct) === "warn" ? "text-amber-500" : "text-emerald-500")}
                        ariaLabel={`cluster ${label} history`}
                      />
                    </div>
                    <div className={cn("mt-1 text-2xl tabular-nums neon-text", valueTone[pctTone(pct)])}>
                      {pct === null ? "—" : `${pct}%`}
                    </div>
                    <div className="text-[10px] text-muted-foreground">of allocatable, cluster-wide</div>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        </div>

        <Card
          title="Needs attention"
          right={`${o.attention.length}`}
          note={[noteFor("pods"), noteFor("nodes"), noteFor("deployments")].filter(Boolean).join(" · ") || undefined}
          icon={o.attention.length ? AlertTriangle : CheckCircle2}
        >
          {o.attention.length ? (
            <ul aria-label="needs attention" className="divide-y divide-border/40 text-xs">
              {o.attention.map((a) => (
                <li key={`${a.kind}/${a.namespace ?? ""}/${a.name}/${a.reason}`}>
                  <Link
                    href={attentionHref(base, a)}
                    className="flex items-center gap-3 px-4 py-1.5 hover:bg-foreground/[0.03]"
                  >
                    <span className="w-24 shrink-0 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{a.kind}</span>
                    <span className="w-56 shrink-0 truncate text-foreground" title={a.name}>
                      {a.namespace ? <span className="text-muted-foreground">{a.namespace}/</span> : null}
                      {a.name}
                    </span>
                    <span
                      className={cn(
                        "w-40 shrink-0",
                        a.reason === "Pending" || a.reason === "Restarting" || a.reason === "Unavailable"
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {a.reason}
                    </span>
                    <span className="flex-1 truncate text-muted-foreground" title={a.detail}>{a.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-4 py-3 text-xs text-emerald-600 dark:text-emerald-400">Nothing needs attention.</div>
          )}
        </Card>

        <Card title="Recent warnings" right={o.warnings ? `${o.warnings.length} newest` : ""} note={noteFor("events")} icon={Activity}>
          {o.warnings?.length ? (
            <ul className="divide-y divide-border/40 text-xs">
              {o.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-1.5">
                  <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{formatAge(w.ageSeconds)}</span>
                  <span className="w-40 shrink-0 truncate text-amber-600 dark:text-amber-400">{w.reason}</span>
                  <span className="w-56 shrink-0 truncate text-foreground" title={w.object}>
                    <span className="text-muted-foreground">{w.namespace}/</span>
                    {w.object}
                  </span>
                  <span className="flex-1 break-words text-muted-foreground">
                    {w.message}
                    {w.count > 1 ? <span className="ml-1 opacity-70">×{w.count}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : o.warnings ? (
            <div className="px-4 py-3 text-xs text-muted-foreground">No Warning events.</div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function attentionHref(base: string, a: AttentionItem): string {
  const select = `select=${encodeURIComponent(a.name)}`;
  if (a.kind === "Node") return `${base}/nodes?${select}`;
  const path = a.kind === "Pod" ? "pods" : "deployments";
  return `${base}/${path}?ns=${encodeURIComponent(a.namespace ?? "*")}&${select}`;
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  bar,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  sub: string;
  tone: Tone;
  bar?: number | null;
}) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border px-3 py-2.5", ringTone[tone])}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className={cn("mt-1 truncate text-lg font-semibold leading-none tabular-nums tracking-tight neon-text", valueTone[tone])}>
        {value}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={sub}>{sub}</div>
      {bar != null ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", tone === "alert" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : "bg-emerald-500")}
            style={{ width: `${Math.min(100, Math.max(2, bar))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Card({
  title,
  right,
  note,
  icon: Icon,
  children,
}: {
  title: string;
  right?: string;
  note?: string;
  icon?: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card/40">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2">
        <h2 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {Icon ? <Icon className="size-3" /> : null}
          {title}
        </h2>
        {right ? <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{right}</span> : null}
      </header>
      {note ? (
        <div className="border-b border-border/60 px-4 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
          not visible with this kubeconfig · {note}
        </div>
      ) : null}
      {children}
    </section>
  );
}
