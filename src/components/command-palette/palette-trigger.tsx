"use client";

import { useEffect, useState } from "react";
import { openCommandPalette } from "@/lib/command-palette/palette-events";

export function PaletteTrigger() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  return (
    <button
      onClick={openCommandPalette}
      title="Command palette"
      className="hidden sm:inline-flex items-center gap-1 rounded-md border border-border/70 px-2 h-7 text-[11px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
    >
      <span>Search</span>
      <kbd className="font-mono text-[10px] opacity-80">{mac ? "⌘K" : "Ctrl K"}</kbd>
    </button>
  );
}
