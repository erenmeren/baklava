"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { Moon, Sun, Monitor } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center justify-center size-8 rounded-md",
          "text-muted-foreground hover:text-foreground",
          "transition-colors hover:bg-foreground/5",
          "focus-visible:outline-2 focus-visible:outline-offset-2"
        )}
        aria-label="Toggle theme"
      >
        <Sun
          className={cn(
            "size-4 transition-all",
            isDark ? "scale-0 -rotate-90" : "scale-100 rotate-0"
          )}
        />
        <Moon
          className={cn(
            "absolute size-4 transition-all",
            isDark ? "scale-100 rotate-0" : "scale-0 rotate-90"
          )}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        <DropdownMenuItem
          onClick={() => setTheme("light")}
          className={cn(theme === "light" && "text-brand")}
        >
          <Sun className="size-3.5" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("dark")}
          className={cn(theme === "dark" && "text-brand")}
        >
          <Moon className="size-3.5" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setTheme("system")}
          className={cn(theme === "system" && "text-brand")}
        >
          <Monitor className="size-3.5" /> System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
