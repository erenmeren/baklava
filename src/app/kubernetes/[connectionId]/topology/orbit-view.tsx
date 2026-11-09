"use client";

import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { TopologyNode } from "@/lib/kubernetes/topology";
import type { ClusterTopologyResult } from "@/lib/connections/kubernetes/topology";
import { HEX, podHex, podTitle, roleHex, roleLabel, roleText, UsageBar, WorkloadTable } from "./parts";

const CP_RING = 120;
const WORKER_RING = 260;
const SPILL_RING = 410;
const RING_CAPACITY = 12;
const MAX_DOTS = 40;
/** Dots per orbit ring around a node; past this a second ring starts. */
const DOTS_PER_RING = 20;

interface Placed {
  node: TopologyNode;
  x: number;
  y: number;
}

function ring(nodes: TopologyNode[], r: number, cx: number, cy: number, offset: number): Placed[] {
  return nodes.map((node, i) => {
    const a = -Math.PI / 2 + offset + (i * 2 * Math.PI) / nodes.length;
    return { node, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
}

const short = (s: string) => (s.length > 18 ? `${s.slice(0, 17)}…` : s);

/**
 * Orbit view: the cluster hub in the middle, control-plane nodes on the inner
 * ring, workers outside (a second ring past 12), pods circling their node.
 */
export function OrbitView({ base, topology: t }: { base: string; topology: ClusterTopologyResult }) {
  const [selected, setSelected] = useState<string | null>(null);

  const cps = t.nodes.filter((n) => n.role === "control-plane");
  const workers = t.nodes.filter((n) => n.role !== "control-plane");
  const outer = workers.slice(0, RING_CAPACITY);
  const spill = workers.slice(RING_CAPACITY);
  const extent = Math.max(220, (spill.length ? SPILL_RING : outer.length ? WORKER_RING : CP_RING) + 80);
  const c = extent; // viewBox starts at 0,0 so CSS transform-origin is in user units
  const placed = [
    ...ring(cps, CP_RING, c, c, 0),
    ...ring(outer, WORKER_RING, c, c, Math.PI / outer.length + 0.35),
    // Offset by half an outer step so spilled nodes sit between, not behind, the outer ones.
    ...ring(spill, SPILL_RING, c, c, (2 * Math.PI) / outer.length + 0.35),
  ];
  const current = t.nodes.find((n) => n.name === selected) ?? null;
  const toggle = (name: string) => setSelected((s) => (s === name ? null : name));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="glass rounded-xl border border-white/[0.14] bg-card/40 p-2">
        <svg
          viewBox={`0 0 ${2 * extent} ${2 * extent}`}
          role="img"
          aria-label="cluster orbit"
          className="mx-auto block h-auto max-h-[74vh] w-full"
        >
          <style>{`
            @keyframes topo-orbit { to { transform: rotate(360deg); } }
            @media (prefers-reduced-motion: no-preference) {
              .topo-orbit { animation: topo-orbit linear infinite; }
            }
            .topo-node:focus-visible { outline: none; }
            .topo-node:focus-visible .topo-core { stroke-width: 3; }
          `}</style>
          <defs>
            <radialGradient id="topo-hub">
              <stop offset="0" stopColor={HEX.ok} stopOpacity="0.85" />
              <stop offset="1" stopColor={HEX.ok} stopOpacity="0" />
            </radialGradient>
          </defs>
          {cps.length ? <circle cx={c} cy={c} r={CP_RING} fill="none" stroke="rgba(167,139,250,.28)" strokeDasharray="3 6" /> : null}
          {outer.length ? <circle cx={c} cy={c} r={WORKER_RING} fill="none" stroke="rgba(56,189,248,.22)" strokeDasharray="3 6" /> : null}
          {spill.length ? <circle cx={c} cy={c} r={SPILL_RING} fill="none" stroke="rgba(56,189,248,.16)" strokeDasharray="3 6" /> : null}
          {placed.map((p) => (
            <line key={`l-${p.node.name}`} x1={c} y1={c} x2={p.x} y2={p.y} stroke={roleHex[p.node.role]} strokeOpacity={0.3} />
          ))}
          <circle cx={c} cy={c} r={44} fill="url(#topo-hub)" />
          <text x={c} y={c + 4} textAnchor="middle" fontSize={13} fill="#ecfdf5" fontFamily="var(--font-mono, monospace)">
            cluster
          </text>

          {placed.map((p, i) => (
            <OrbitNode key={p.node.name} {...p} index={i} active={p.node.name === selected} onToggle={() => toggle(p.node.name)} />
          ))}
        </svg>
      </div>

      <aside aria-label="node details" className="glass h-fit rounded-xl border border-white/[0.14] bg-card/40 p-3 text-[12px]">
        {current ? (
          <div className="space-y-3">
            <div>
              <div className={cn("text-[10px] uppercase tracking-[0.18em]", roleText[current.role])}>{roleLabel[current.role]}</div>
              <b className="break-all font-mono text-[14px] text-foreground">{current.name}</b>
              {current.ready === false ? <span className="ml-2 text-rose-300">NotReady</span> : null}
            </div>
            {current.cpu && current.mem ? (
              <div className="space-y-2">
                <UsageBar label="CPU" usage={current.cpu} />
                <UsageBar label="MEM" usage={current.mem} />
              </div>
            ) : null}
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{current.podCount} pods</div>
            <WorkloadTable base={base} workloads={current.workloads} compact />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Cluster</div>
            <div className="text-muted-foreground">
              {t.summary.nodes} {t.summary.nodes === 1 ? "node" : "nodes"} · {t.summary.pods} {t.summary.pods === 1 ? "pod" : "pods"}
              {t.unscheduled.length ? (
                <span className="text-amber-300"> · {t.unscheduled.reduce((s, w) => s + w.replicas, 0)} unscheduled</span>
              ) : null}
            </div>
            <div className="text-muted-foreground">Click a node to see what runs on it.</div>
          </div>
        )}
      </aside>
    </div>
  );
}

function OrbitNode({
  node: n,
  x,
  y,
  index,
  active,
  onToggle,
}: Placed & { index: number; active: boolean; onToggle: () => void }) {
  const pods = n.workloads.flatMap((w) => w.pods);
  const shown = pods.slice(0, MAX_DOTS);
  const hidden = pods.length - shown.length;
  const two = shown.length > DOTS_PER_RING;
  const orbit = 36;
  const color = roleHex[n.role];
  const core = active ? 27 : 20;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <g
      className="topo-node cursor-pointer"
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${n.name} ${roleLabel[n.role]}`}
      onClick={onToggle}
      onKeyDown={onKey}
    >
      <g className="topo-orbit" style={{ transformOrigin: `${x}px ${y}px`, animationDuration: `${40 + index * 6}s` }}>
        {shown.map((p, k) => {
          const inner = !two || k < DOTS_PER_RING;
          const count = inner ? Math.min(shown.length, DOTS_PER_RING) : shown.length - DOTS_PER_RING;
          const slot = inner ? k : k - DOTS_PER_RING;
          const r = inner ? orbit : orbit + 11;
          const a = (slot * 2 * Math.PI) / count + (inner ? 0 : Math.PI / count);
          const fill = podHex(p);
          const dot = 2.5 + Math.min(3.5, (p.cpuMillicores ?? 0) / 40);
          return (
            <circle key={`${p.namespace}/${p.name}`} cx={x + r * Math.cos(a)} cy={y + r * Math.sin(a)} r={dot} fill={fill} style={{ filter: `drop-shadow(0 0 4px ${fill})` }}>
              <title>{podTitle(p)}</title>
            </circle>
          );
        })}
      </g>
      {/* Opaque backing so the spoke doesn't show through the glass core. */}
      <circle cx={x} cy={y} r={core} fill="#071018" />
      <circle
        className="topo-core"
        cx={x}
        cy={y}
        r={core}
        fill={active ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.08)"}
        stroke={n.ready === false ? HEX.alert : color}
        strokeWidth={active ? 2.5 : 1.5}
        style={{ filter: `drop-shadow(0 0 ${active ? 14 : 8}px ${color})`, transition: "r .3s" }}
      />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={11} fill={color} fontFamily="var(--font-mono, monospace)">
        {n.cpu?.pct != null ? `${n.cpu.pct}%` : n.podCount}
      </text>
      {hidden > 0 ? (
        <text x={x + orbit + 14} y={y - orbit} fontSize={11} fill="#cfe6ee" fontFamily="var(--font-mono, monospace)">
          +{hidden}
        </text>
      ) : null}
      <text
        x={x}
        y={y + orbit + (two ? 11 : 0) + 22}
        textAnchor="middle"
        fontSize={12.5}
        fill={active ? "#ffffff" : "#cfe6ee"}
        stroke="#071018"
        strokeWidth={3}
        paintOrder="stroke"
        fontFamily="var(--font-mono, monospace)"
      >
        <title>{n.name}</title>
        {short(n.name)}
      </text>
    </g>
  );
}
