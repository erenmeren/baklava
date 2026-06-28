"use client";

import { useTheme } from "@/components/theme-provider";

/** Opt-in CRT scanline overlay — only renders under Phosphor when enabled. */
export function CrtOverlay() {
  const { palette, scanlines } = useTheme();
  if (palette !== "phosphor" || !scanlines) return null;
  return <div className="crt-overlay" aria-hidden />;
}
