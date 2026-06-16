"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { openCommandPalette } from "@/lib/command-palette/palette-events";

export function PaletteTrigger() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  const combo = mac ? "⌘K" : "Ctrl K";

  return (
    <>
      {/* Full search field — sm and up. Styled like an input so it reads as
          the primary action rather than one more icon button. */}
      <button
        onClick={openCommandPalette}
        title="Search or jump to…"
        aria-label="Open command palette"
        className="hidden sm:flex items-center gap-2 h-8 w-44 lg:w-56 rounded-md border border-border/70 bg-foreground/[0.02] pl-2.5 pr-1.5 text-muted-foreground transition-colors hover:text-foreground hover:border-border hover:bg-foreground/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Search className="size-3.5 shrink-0" strokeWidth={2} />
        <span className="text-[12px] truncate">Search or jump to…</span>
        <kbd className="ml-auto shrink-0 rounded border border-border/70 bg-background px-1 py-px font-mono text-[10px] leading-none text-muted-foreground/90">
          {combo}
        </kbd>
      </button>

      {/* Icon-only fallback below sm so the field never crowds the tabs. */}
      <button
        onClick={openCommandPalette}
        title={`Search (${combo})`}
        aria-label="Open command palette"
        className="sm:hidden inline-flex items-center justify-center size-8 rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5"
      >
        <Search className="size-4" />
      </button>
    </>
  );
}
