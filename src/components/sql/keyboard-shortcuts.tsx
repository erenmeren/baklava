"use client";

import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** True on macOS — drives ⌘ vs Ctrl labelling. Resolves on the client only. */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const p =
      (typeof navigator !== "undefined" &&
        ((navigator as Navigator & { userAgentData?: { platform?: string } })
          .userAgentData?.platform ||
          navigator.platform ||
          navigator.userAgent)) ||
      "";
    setIsMac(/mac|iphone|ipad/i.test(p));
  }, []);
  return isMac;
}

/** Compact inline hint for the Run button etc. (e.g. "⌘↵" / "Ctrl+↵"). */
export function runHint(isMac: boolean): string {
  return isMac ? "⌘↵" : "Ctrl+↵";
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none text-foreground/80 shadow-[0_1px_0_var(--border)]">
      {children}
    </kbd>
  );
}

interface Shortcut {
  label: string;
  keys: string[];
  note?: string;
}

// Shared across both SQL editors. The first three are wired by the editors
// themselves; the rest are CodeMirror's built-in keymap (basicSetup).
function shortcuts(mod: string): Shortcut[] {
  return [
    { label: "Run query", keys: [mod, "↵"], note: "runs the selection if any" },
    { label: "Format SQL", keys: [mod, "⇧", "F"] },
    { label: "Explain", keys: [mod, "E"] },
    { label: "Toggle comment", keys: [mod, "/"] },
    { label: "Autocomplete", keys: ["Ctrl", "Space"] },
    { label: "Undo", keys: [mod, "Z"] },
    { label: "Redo", keys: [mod, "⇧", "Z"] },
  ];
}

export function ShortcutCheatsheet({ className }: { className?: string }) {
  const isMac = useIsMac();
  const mod = isMac ? "⌘" : "Ctrl";
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground",
              className,
            )}
          >
            <Keyboard className="size-4" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-border/60 px-3 py-2 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Keyboard shortcuts
        </div>
        <ul className="p-1.5">
          {shortcuts(mod).map((s) => (
            <li
              key={s.label}
              className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-foreground/[0.04]"
            >
              <span className="min-w-0">
                <span className="text-[12.5px] text-foreground">{s.label}</span>
                {s.note ? (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    {s.note}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, i) => (
                  <Kbd key={i}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
