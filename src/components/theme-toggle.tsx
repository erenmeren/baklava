"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Single-button theme toggle.
 *
 * - On first paint the theme is whatever the server resolved (cookie or
 *   "system"). When in system mode it follows OS preference automatically.
 * - One click flips to the *opposite* of the currently resolved theme and
 *   pins it explicitly (light ↔ dark). After the first click the user's
 *   choice sticks regardless of the OS — same mental model as Linear,
 *   Vercel, Stripe Dashboard.
 *
 * The icon shows the current state (Sun = light, Moon = dark); the title
 * advertises what the next click will do.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Render-after-mount guard so the SSR-rendered icon doesn't flash the
  // wrong state before the client-side theme resolves.
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light" : "Switch to dark"}
      className={cn(
        "relative inline-flex size-8 items-center justify-center rounded-md",
        "text-muted-foreground hover:text-foreground",
        "transition-colors hover:bg-foreground/5",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
      )}
    >
      <Sun
        className={cn(
          "absolute size-4 transition-all duration-300",
          isDark ? "scale-0 -rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100",
        )}
      />
      <Moon
        className={cn(
          "absolute size-4 transition-all duration-300",
          isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 rotate-90 opacity-0",
        )}
      />
    </button>
  );
}
