"use client";

import { cn } from "@/lib/utils";

interface Props {
  containers: string[];
  value: string | null;
  onChange: (container: string) => void;
}

/**
 * Container selector for the log and shell overlays. A single-container pod
 * renders nothing — the picker only earns its space when there's a choice,
 * and until now there was no way to reach the second container at all.
 */
export function ContainerPicker({ containers, value, onChange }: Props) {
  if (containers.length < 2) return null;
  const selected = value ?? containers[0];
  return (
    <div className="flex items-center gap-1" role="group" aria-label="container">
      <span className="uppercase tracking-[0.22em] text-[9px] text-muted-foreground">
        ctr
      </span>
      {containers.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          aria-pressed={c === selected}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10.5px] transition-colors",
            c === selected
              ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
