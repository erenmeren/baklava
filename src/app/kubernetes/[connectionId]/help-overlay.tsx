"use client";

import { useEffect } from "react";

interface Props {
  onClose: () => void;
}

const SECTIONS: { title: string; rows: { k: string; desc: string }[] }[] = [
  {
    title: "Navigation",
    rows: [
      { k: "1 … 6", desc: "jump to resource (pods, deploy, …)" },
      { k: ":", desc: "open command palette" },
      { k: "/", desc: "filter visible rows" },
      { k: "?", desc: "this help" },
      { k: "Esc", desc: "close overlay / clear filter" },
    ],
  },
  {
    title: "Selection",
    rows: [
      { k: "↑ ↓ / j k", desc: "move selection" },
      { k: "g", desc: "first row" },
      { k: "G", desc: "last row" },
      { k: "↵", desc: "describe selected" },
    ],
  },
  {
    title: "Actions",
    rows: [
      { k: "l", desc: "view logs (pods)" },
      { k: "s", desc: "open shell (exec)" },
      { k: "y", desc: "view YAML" },
      { k: "e", desc: "edit in place" },
      { k: "D", desc: "delete selected (capital)" },
      { k: "S", desc: "scale deployment (capital)" },
      { k: "R", desc: "rollout restart deployment / drain node (capital)" },
      { k: "C", desc: "cordon or uncordon node (capital)" },
      { k: "F", desc: "GET a pod's HTTP port via the apiserver (capital)" },
    ],
  },
  {
    title: "Namespaces",
    rows: [
      { k: ": ns <name>", desc: "switch namespace" },
      { k: ": ns *", desc: "all-namespaces" },
      { k: "ctrl-a", desc: "all-namespaces toggle (alias)" },
    ],
  },
];

export function HelpOverlay({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" || e.key === "?") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
      <div className="relative z-10 w-full max-w-3xl rounded-lg border border-border/70 bg-popover shadow-2xl shadow-black/30 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-muted/30 font-mono">
          <div className="flex items-center gap-3">
            <span className="text-cyan-600 dark:text-cyan-400 text-base leading-none">
              ?
            </span>
            <span className="text-sm font-semibold">Keybindings</span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              k9s · mode
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xs font-mono"
          >
            esc to close
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 p-6 font-mono text-xs">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <div className="uppercase tracking-[0.22em] text-[9px] text-muted-foreground mb-2">
                {s.title}
              </div>
              <div className="space-y-1.5">
                {s.rows.map((r) => (
                  <div
                    key={r.k}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-foreground/80">{r.desc}</span>
                    <kbd className="rounded border border-border/60 bg-background/60 px-1.5 py-0.5 text-[10px]">
                      {r.k}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
