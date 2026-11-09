"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TopologyNode, TopologyWorkload } from "@/lib/kubernetes/topology";
import type { ClusterTopologyResult } from "@/lib/connections/kubernetes/topology";
import { useK8s } from "../k8s-context";
import { Chip, pctTone, podHex, podTitle, roleLabel, roleText, toneText, UsageBar, WorkloadTable } from "./parts";
import { OrbitView } from "./orbit-view";

export const VIEW_KEY = "baklava:k8s-topology-view";
type View = "cards" | "orbit";

/**
 * Cluster topology — which nodes exist and what runs on each. Two views of the
 * same server-built data: node cards (A) and an orbit diagram (B). Re-rendered
 * by the shell's periodic refresh; expansion / selection survive it.
 */
export function TopologyView({ topology: t }: { topology: ClusterTopologyResult }) {
  const { connectionId } = useK8s();
  const base = `/kubernetes/${connectionId}`;
  const [view, setView] = useState<View>("cards");

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "orbit") setView("orbit");
    } catch {
      // Private window / blocked storage: default view.
    }
  }, []);

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Not persisted — still switches for this visit.
    }
  };

  const s = t.summary;
  return (
    <div className="h-full overflow-auto">
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip label="Nodes" value={s.nodes} className="text-sky-300" />
          <Chip label="Control plane" value={s.controlPlane} className="text-violet-300" />
          <Chip label="Workers" value={s.workers} className="text-emerald-300" />
          <Chip label="Pods" value={s.pods} className="text-lime-300" />
          {s.cpuPct !== null ? <Chip label="CPU" value={`${s.cpuPct}%`} className={toneText[pctTone(s.cpuPct)]} /> : null}
          {s.memPct !== null ? <Chip label="Memory" value={`${s.memPct}%`} className={toneText[pctTone(s.memPct)]} /> : null}
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {t.namespace === "*" ? "pods: all namespaces" : `pods: ns ${t.namespace}`}
          </span>
          <div role="group" aria-label="Topology view" className="glass ml-auto inline-flex rounded-full border border-white/10 p-0.5">
            {(["cards", "orbit"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => choose(v)}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] transition-colors",
                  view === v ? "bg-emerald-400/15 text-emerald-300" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "cards" ? "Cards" : "Orbit"}
              </button>
            ))}
          </div>
        </div>

        {t.metricsMissing || t.notes.length ? (
          <div className="space-y-1 font-mono text-[11px] text-amber-300">
            {t.metricsMissing ? (
              <div className="text-muted-foreground">metrics-server not installed — usage needs the metrics.k8s.io API.</div>
            ) : null}
            {t.notes.map((n) => (
              <div key={n.section}>
                {n.section} · {n.error}
              </div>
            ))}
          </div>
        ) : null}

        {view === "cards" ? <CardsView base={base} topology={t} /> : <OrbitView base={base} topology={t} />}
      </div>
    </div>
  );
}

function CardsView({ base, topology: t }: { base: string; topology: ClusterTopologyResult }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (name: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const bands: Array<[string, TopologyNode[]]> = [
    ["Control plane", t.nodes.filter((n) => n.role === "control-plane")],
    ["Workers", t.nodes.filter((n) => n.role === "worker")],
    ["Nodes (details not visible)", t.nodes.filter((n) => n.role === "unknown")],
  ];

  return (
    <div className="space-y-5">
      {bands.map(([label, nodes]) =>
        nodes.length ? (
          <section key={label} aria-label={label}>
            <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {nodes.map((n) => (
                <NodeCard key={n.name} base={base} node={n} open={open.has(n.name)} onToggle={() => toggle(n.name)} />
              ))}
            </div>
          </section>
        ) : null,
      )}
      {!t.nodes.length ? <div className="text-xs text-muted-foreground">No nodes visible.</div> : null}
      {t.unscheduled.length ? <UnscheduledBand base={base} workloads={t.unscheduled} /> : null}
    </div>
  );
}

function NodeCard({ base, node: n, open, onToggle }: { base: string; node: TopologyNode; open: boolean; onToggle: () => void }) {
  const pods = n.workloads.flatMap((w) => w.pods);
  return (
    <div
      className={cn(
        "glass rounded-xl border bg-card/40 transition-shadow hover:shadow-[0_0_30px_-8px_rgba(52,211,153,0.45)]",
        n.role === "control-plane" ? "border-violet-400/40" : "border-white/[0.14]",
        open && "col-span-full",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${n.name} ${roleLabel[n.role]}`}
        onClick={onToggle}
        className="block w-full rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        <div className="flex items-center justify-between gap-2">
          <b className="truncate font-mono text-[13px] text-foreground" title={n.name}>{n.name}</b>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={cn("rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10.5px]", roleText[n.role])}>
              {roleLabel[n.role]}
              {n.ready === null ? null : n.ready ? " · Ready" : <span className="text-rose-300"> · NotReady</span>}
            </span>
            <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
          </span>
        </div>
        {n.cpu && n.mem ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <UsageBar label="CPU" usage={n.cpu} />
            <UsageBar label="MEM" usage={n.mem} />
          </div>
        ) : null}
        <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>{n.podCount} pods</span>
          <span>{n.workloads.length} workloads</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-[3px]" aria-hidden>
          {pods.map((p) => (
            <i
              key={`${p.namespace}/${p.name}`}
              title={podTitle(p)}
              className="size-2.5 rounded-[3px]"
              style={{ background: podHex(p), boxShadow: `0 0 6px ${podHex(p)}` }}
            />
          ))}
        </div>
      </button>
      {open ? (
        <div className="border-t border-white/10 px-3 pb-3 pt-2">
          <WorkloadTable base={base} workloads={n.workloads} />
        </div>
      ) : null}
    </div>
  );
}

function UnscheduledBand({ base, workloads }: { base: string; workloads: TopologyWorkload[] }) {
  return (
    <section aria-label="Unscheduled">
      <h2 className="mb-2 text-[10px] uppercase tracking-[0.18em] text-amber-300">Unscheduled</h2>
      <div className="glass rounded-xl border border-amber-400/30 bg-card/40 p-3">
        <WorkloadTable base={base} workloads={workloads} />
      </div>
    </section>
  );
}
