"use client";

import { useTheme } from "@/components/theme-provider";
import type { Palette } from "@/lib/theme";
import { SwatchBook } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const PALETTES: { value: Palette; label: string; hint: string; swatch: string[] }[] = [
  {
    value: "classic",
    label: "Classic",
    hint: "Warm cream & honey",
    swatch: ["#FCFAF5", "#E0A53B", "#16140F"],
  },
  {
    value: "phosphor",
    label: "Phosphor",
    hint: "Amber CRT terminal",
    swatch: ["#0E1114", "#F2A93B", "#A6C85C"],
  },
];

/** Palette switcher (Classic ↔ Phosphor), independent of the light/dark toggle. */
export function ThemeSelector() {
  const { palette, setPalette, scanlines, setScanlines } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Change theme"
        title="Change theme"
        className={cn(
          "relative inline-flex size-8 items-center justify-center rounded-md",
          "text-muted-foreground hover:text-foreground",
          "transition-colors hover:bg-foreground/5",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
        )}
      >
        <SwatchBook className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          Theme
        </div>
        <DropdownMenuRadioGroup
          value={palette}
          onValueChange={(v) => setPalette(v as Palette)}
        >
          {PALETTES.map((p) => (
            <DropdownMenuRadioItem
              key={p.value}
              value={p.value}
              className="gap-2"
            >
              <span
                aria-hidden
                className="flex size-4 shrink-0 overflow-hidden rounded-full border border-border/60"
              >
                {p.swatch.map((c, i) => (
                  <span key={i} className="flex-1" style={{ background: c }} />
                ))}
              </span>
              <span className="flex flex-col">
                <span className="text-sm leading-tight">{p.label}</span>
                <span className="text-[11px] leading-tight text-muted-foreground">
                  {p.hint}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {palette === "phosphor" ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={scanlines}
              onCheckedChange={(v) => setScanlines(Boolean(v))}
            >
              CRT scanlines
            </DropdownMenuCheckboxItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
