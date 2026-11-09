"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCpu, formatMemory } from "@/lib/kubernetes/usage";
import type { NodeRole, TopologyPod, TopologyWorkload, Usage } from "@/lib/kubernetes/topology";

/** Raw hex (SVG fills) for the theme's neon tones. */
export const HEX = {
  ok: "#34d399",
  idle: "#38bdf8",
  warn: "#fbbf24",
  alert: "#fb7185",
  cp: "#a78bfa",
  muted: "#64748b",
} as const;

export type Tone = "ok" | "warn" | "alert";

export function pctTone(p: number | null): Tone {
  if (p === null) return "ok";
  return p >= 85 ? "alert" : p >= 60 ? "warn" : "ok";
}

export const toneText: Record<Tone, string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  alert: "text-rose-300",
};

export const roleLabel: Record<NodeRole, string> = {
  "control-plane": "control-plane",
  worker: "worker",
  unknown: "node",
};

export const roleText: Record<NodeRole, string> = {
  "control-plane": "text-violet-300",
  worker: "text-emerald-300",
  unknown: "text-sky-300",
};

export const roleHex: Record<NodeRole, string> = {
  "control-plane": HEX.cp,
  worker: HEX.ok,
  unknown: HEX.idle,
};

/** Status colour of one pod: problem → rose, pending → amber, busy → emerald, idle → sky. */
export function podHex(p: TopologyPod): string {
  if (p.problem) return HEX.alert;
  if (p.phase === "Pending") return HEX.warn;
  if (p.phase !== "Running") return HEX.muted;
  return p.cpuMillicores !== null && p.cpuMillicores >= 20 ? HEX.ok : HEX.idle;
}

export function podTitle(p: TopologyPod): string {
  const usage = p.cpuMillicores !== null ? ` · ${formatCpu(p.cpuMillicores)} · ${formatMemory(p.memBytes)}` : "";
  return `${p.namespace}/${p.name} · ${p.problem ?? p.phase}${usage}`;
}

const KIND_PATH: Record<string, string> = {
  Deployment: "deployments",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  Job: "jobs",
  CronJob: "cronjobs",
  ReplicaSet: "replicasets",
};

/** The workload's list page, scoped to its namespace with the row selected. */
export function workloadHref(base: string, w: TopologyWorkload): string {
  const path = KIND_PATH[w.kind] ?? "pods";
  // Unknown owner kinds (CRD controllers) land on the pod itself.
  const name = KIND_PATH[w.kind] ? w.name : w.pods[0]?.name ?? w.name;
  return `${base}/${path}?ns=${encodeURIComponent(w.namespace)}&select=${encodeURIComponent(name)}`;
}

export function Chip({ label, value, className }: { label: string; value: string | number; className: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[11px] text-muted-foreground">
      {label}
      <b className={cn("font-semibold tabular-nums neon-text", className)}>{value}</b>
    </span>
  );
}

export function UsageBar({ label, usage }: { label: string; usage: Usage }) {
  const tone = pctTone(usage.pct);
  const bar = tone === "alert" ? "bg-rose-400" : tone === "warn" ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">
        {label} <b className={cn("font-mono tabular-nums neon-text", toneText[tone])}>{usage.pct ?? "—"}%</b>
      </div>
      <div className="mt-1 h-[5px] overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className={cn("h-full rounded-full shadow-[0_0_10px_currentColor]", bar, toneText[tone])}
          style={{ width: `${Math.min(100, Math.max(2, usage.pct ?? 0))}%` }}
        />
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
        {label === "CPU"
          ? `${formatCpu(usage.used)} / ${formatCpu(usage.allocatable)}`
          : `${formatMemory(usage.used)} / ${formatMemory(usage.allocatable)}`}
      </div>
    </div>
  );
}

/** Workload rows: name, replicas on this node, CPU / memory per pod. Each row opens its list page. */
export function WorkloadTable({ base, workloads, compact = false }: { base: string; workloads: TopologyWorkload[]; compact?: boolean }) {
  if (!workloads.length) return <div className="py-2 text-xs text-muted-foreground">No pods.</div>;
  const cols = compact ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[minmax(0,1.6fr)_4rem_6rem_6rem]";
  return (
    <div role="table" aria-label="workloads" className="font-mono text-[12px]">
      <div role="row" className={cn("grid gap-3 border-b border-white/10 pb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground", cols)}>
        <span role="columnheader">Workload</span>
        <span role="columnheader" className="text-right">Replicas</span>
        <span role="columnheader" className="text-right">CPU / pod</span>
        {compact ? null : <span role="columnheader" className="text-right">MEM / pod</span>}
      </div>
      {workloads.map((w) => (
        <Link
          key={`${w.kind}/${w.namespace}/${w.name}`}
          role="row"
          href={workloadHref(base, w)}
          title={`${w.kind} ${w.namespace}/${w.name}`}
          className={cn("grid items-baseline gap-3 border-b border-dashed border-white/[0.06] py-1.5 hover:bg-white/[0.04]", cols)}
        >
          <span role="cell" className={cn("min-w-0 truncate", w.problem ? "text-rose-300" : "text-foreground")}>
            {compact ? null : <span className="mr-2 text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">{w.kind}</span>}
            <span className="text-muted-foreground">{w.namespace}/</span>
            {w.name}
          </span>
          <span role="cell" className="text-right tabular-nums">{compact ? `×${w.replicas}` : w.replicas}</span>
          <span role="cell" className="text-right tabular-nums text-emerald-300">{formatCpu(w.cpuPerPod)}</span>
          {compact ? null : <span role="cell" className="text-right tabular-nums text-sky-300">{formatMemory(w.memPerPod)}</span>}
        </Link>
      ))}
    </div>
  );
}
