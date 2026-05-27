"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  namespaces: string[];
  onRun: (cmd: string) => void;
  onClose: () => void;
}

interface Suggestion {
  cmd: string;
  hint: string;
  group: "resource" | "namespace" | "verb";
}

const RESOURCE_SUGGESTIONS: Suggestion[] = [
  { cmd: "pods", hint: "list pods (po)", group: "resource" },
  { cmd: "deployments", hint: "list deployments (deploy)", group: "resource" },
  { cmd: "services", hint: "list services (svc)", group: "resource" },
  { cmd: "configmaps", hint: "list configmaps (cm)", group: "resource" },
  { cmd: "secrets", hint: "list secrets (sec)", group: "resource" },
  { cmd: "namespaces", hint: "list namespaces (ns)", group: "resource" },
];

/**
 * `:`-triggered command palette in the k9s spirit. Accepts resource names
 * (po / pods / deploy / svc / cm / sec / ns) and namespace switches
 * (`:ns payments`, `:ns *`).
 */
export function CommandPalette({ namespaces, onRun, onClose }: Props) {
  const [value, setValue] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  // Namespace-switch suggestions when the user typed "ns " (or "namespace ").
  const nsPrefix = lower.startsWith("ns ") || lower.startsWith("namespace ");
  const suggestions: Suggestion[] = (() => {
    if (nsPrefix) {
      const q = lower.replace(/^(ns|namespace)\s+/, "");
      const filtered = ["*", ...namespaces].filter((n) =>
        n.toLowerCase().includes(q),
      );
      return filtered.map((n) => ({
        cmd: `ns ${n}`,
        hint: n === "*" ? "switch to all namespaces" : `switch to ns/${n}`,
        group: "namespace" as const,
      }));
    }
    if (!lower) return RESOURCE_SUGGESTIONS;
    return RESOURCE_SUGGESTIONS.filter((s) =>
      s.cmd.toLowerCase().includes(lower),
    );
  })();

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(suggestions.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[active];
      onRun(pick ? pick.cmd : trimmed);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
      <div className="relative z-10 w-full max-w-xl rounded-lg border border-border/70 bg-popover shadow-2xl shadow-black/30 overflow-hidden">
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/60 bg-muted/30 font-mono">
          <span className="text-cyan-600 dark:text-cyan-400 text-base leading-none">
            :
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="pods · deploy · svc · ns payments …"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/60"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            ⎋
          </kbd>
        </div>
        <div className="max-h-[40vh] overflow-y-auto py-1 font-mono text-xs">
          {suggestions.length === 0 ? (
            <div className="px-4 py-6 text-center text-muted-foreground">
              no match for{" "}
              <span className="text-foreground">&apos;{trimmed}&apos;</span>
            </div>
          ) : (
            suggestions.map((s, i) => (
              <button
                key={`${s.group}-${s.cmd}`}
                onClick={() => onRun(s.cmd)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "w-full flex items-center gap-3 px-3.5 py-1.5 text-left transition-colors",
                  i === active ? "bg-cyan-500/10" : "hover:bg-foreground/5",
                )}
              >
                <span
                  className={cn(
                    "uppercase tracking-[0.22em] text-[9px] w-[60px]",
                    s.group === "namespace"
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "text-muted-foreground",
                  )}
                >
                  {s.group === "namespace" ? "ns" : "go"}
                </span>
                <span className="text-foreground flex-1 truncate">
                  {s.cmd}
                </span>
                <span className="text-muted-foreground text-[10px]">
                  {s.hint}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="px-3.5 py-1.5 border-t border-border/60 bg-muted/30 font-mono text-[10px] text-muted-foreground flex items-center gap-3">
          <span>
            <kbd className="px-1 py-0 border border-border/60 rounded">↑↓</kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="px-1 py-0 border border-border/60 rounded">↵</kbd>{" "}
            run
          </span>
          <span className="ml-auto">
            try{" "}
            <span className="text-foreground/90">ns payments</span> ·{" "}
            <span className="text-foreground/90">deploy</span>
          </span>
        </div>
      </div>
    </div>
  );
}
