"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface Props {
  mode: "describe" | "yaml";
  title: string;
  content: string;
  onClose: () => void;
}

/**
 * Right-side slide-over for the describe / yaml view. Looks like a terminal
 * sub-view: dark surface, mono content, line-numbered gutter.
 */
export function DetailOverlay({ mode, title, content, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const lines = content.split("\n");

  return (
    <div
      className="fixed inset-0 z-40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px]" />
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-popover border-l border-border/70 shadow-2xl shadow-black/30 flex flex-col">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-muted/30 font-mono">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                "uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded",
                mode === "yaml"
                  ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                  : "bg-pink-500/15 text-pink-700 dark:text-pink-300",
              )}
            >
              {mode}
            </span>
            <span className="text-sm font-medium truncate">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-xs font-mono shrink-0 ml-2"
          >
            esc to close
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-background/40">
          <div className="flex font-mono text-[12px] leading-[1.55]">
            <div className="select-none pr-3 pl-3 py-3 text-right text-muted-foreground/50 border-r border-border/40 bg-muted/20">
              {lines.map((_, i) => (
                <div key={i} className="tabular-nums">
                  {i + 1}
                </div>
              ))}
            </div>
            <pre className="px-4 py-3 flex-1 min-w-0 whitespace-pre text-foreground/90">
              {content}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
