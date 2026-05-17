"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ExternalLink, GripHorizontal, Minus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { LogsTab } from "./[cid]/tabs/logs-tab";

interface DockContainer {
  id: string;
  shortId: string;
  name: string;
  image: string;
  state: string;
}

interface Props {
  connectionId: string;
  container: DockContainer;
  onClose: () => void;
}

const STORAGE_KEY = "baklava:logs-dock-height";
const STORAGE_MIN = "baklava:logs-dock-min";
const MIN_PX = 220;
const COLLAPSED_PX = 44;

function readStoredHeight(): number {
  if (typeof window === "undefined") return 440;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 440;
  return Math.max(MIN_PX, n);
}

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_MIN) === "1";
}

export function ContainerLogsDock({ connectionId, container, onClose }: Props) {
  const [height, setHeight] = useState<number>(440);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const heightRef = useRef(440);

  useEffect(() => {
    const h = readStoredHeight();
    setHeight(h);
    heightRef.current = h;
    setCollapsed(readCollapsed());
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.min(
        Math.max(window.innerHeight - e.clientY, MIN_PX),
        Math.floor(window.innerHeight * 0.85),
      );
      heightRef.current = next;
      setHeight(next);
    };
    const onUp = () => {
      setDragging(false);
      window.localStorage.setItem(STORAGE_KEY, String(heightRef.current));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(STORAGE_MIN, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const effectiveHeight = collapsed ? COLLAPSED_PX : height;
  const running = container.state === "running";

  return (
    <div
      role="region"
      aria-label={`Logs · ${container.name}`}
      style={{ height: effectiveHeight }}
      className={cn(
        "shrink-0 relative flex flex-col",
        // Theme-aware surface. In dark mode this is the dock bg; in light
        // mode it forms the chrome around the (always-dark) terminal body.
        "bg-background text-foreground",
        "border-t border-border",
        // Upward drop-shadow that hugs the page above; intentionally subtle
        // in light mode so it doesn't smudge the cream background.
        "shadow-[0_-14px_30px_-22px_oklch(0_0_0/0.18)] dark:shadow-[0_-22px_42px_-26px_oklch(0_0_0/0.55)]",
        "animate-in slide-in-from-bottom-8 fade-in-0 duration-300 ease-out",
        dragging ? "" : "transition-[height] duration-200 ease-out",
      )}
    >
      {/* Drag handle — a hairline that warms to brand amber on hover */}
      <button
        type="button"
        aria-label="Resize logs panel"
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={toggleCollapsed}
        className={cn(
          "group/handle absolute -top-[3px] inset-x-0 h-[6px] z-10",
          "cursor-row-resize flex items-center justify-center",
          "outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
        )}
      >
        <span
          className={cn(
            "absolute inset-x-0 top-[3px] h-px",
            "bg-gradient-to-r from-transparent via-border to-transparent",
            "group-hover/handle:via-brand/70 group-active/handle:via-brand",
            "transition-colors duration-200",
            dragging && "via-brand",
          )}
        />
        <GripHorizontal
          className={cn(
            "relative z-10 size-3 text-muted-foreground/40",
            "group-hover/handle:text-brand/80 group-active/handle:text-brand",
            "transition-colors duration-150",
            dragging && "text-brand",
          )}
        />
      </button>

      {/* Header bar — theme-aware chrome.
          Light mode: cream-card with dark text + warm hairline rule.
          Dark mode: zinc gradient that fades into the terminal surface. */}
      <header
        className={cn(
          "shrink-0 flex items-center gap-3 px-3.5 pl-4 pr-3 h-11",
          "border-b border-border",
          // Light: layered card with a subtle honey edge at the bottom
          "bg-card",
          // Dark: zinc gradient that fades into the terminal body
          "dark:bg-gradient-to-b dark:from-zinc-900/80 dark:to-[#0a0a0c]",
          "dark:border-b-white/[0.06]",
          // A subtle warm underline only in light mode, so the eye flows
          // from card → terminal without a jarring edge.
          "relative",
        )}
      >
        {/* Honey hairline that sits between header and terminal in light mode */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 -bottom-px h-px",
            "bg-gradient-to-r from-transparent via-brand/30 to-transparent",
            "dark:via-transparent",
          )}
        />

        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          Logs
        </span>
        <span className="text-border" aria-hidden>
          /
        </span>

        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5",
            "border border-border bg-muted/40",
            "dark:border-white/10 dark:bg-white/[0.03]",
            "text-[10px] font-mono uppercase tracking-wider text-foreground/80",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              running
                ? "bg-emerald-500 status-pulse shadow-[0_0_8px_rgba(16,185,129,0.55)]"
                : "bg-muted-foreground/60",
            )}
          />
          {container.state}
        </span>

        <div className="min-w-0 flex items-baseline gap-2">
          <span
            className="font-semibold text-sm text-foreground truncate"
            style={{ fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace" }}
            title={container.name}
          >
            {container.name}
          </span>
          <span
            className="text-[10px] font-mono text-muted-foreground truncate hidden sm:inline"
            title={container.image}
          >
            {container.image}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <span className="hidden md:inline text-[10px] font-mono text-muted-foreground tracking-wider">
            <kbd
              className={cn(
                "px-1.5 py-px rounded border text-foreground/80",
                "border-border bg-muted/50",
                "dark:border-white/10 dark:bg-white/[0.04]",
              )}
            >
              esc
            </kbd>
            <span className="ml-1.5 uppercase">to close</span>
          </span>

          <Link
            href={`/docker/${connectionId}/containers/${container.id}?tab=logs`}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-md px-2",
              "text-[11px] font-mono uppercase tracking-wider",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-foreground/[0.06] transition-colors",
            )}
            title="Open container detail (full view)"
          >
            <ExternalLink className="size-3" />
            full view
          </Link>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand logs panel" : "Collapse logs panel"}
            title={collapsed ? "Expand" : "Collapse"}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-foreground/[0.06] transition-colors",
            )}
          >
            <Minus
              className={cn(
                "size-3.5 transition-transform duration-200",
                collapsed && "rotate-180 -translate-y-px",
              )}
            />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close logs panel"
            title="Close"
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md",
              "text-muted-foreground transition-colors",
              "hover:text-rose-600 hover:bg-rose-500/10",
              "dark:hover:text-rose-300",
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </header>

      {/* Body. Padding shows the theme-aware dock surface; the inner
          LogsTab renders its own toolbar (theme-aware) and terminal
          (intentionally dark in both themes — log terminal convention). */}
      {!collapsed ? (
        <div className="flex-1 min-h-0 px-2 pb-2 pt-2 bg-background">
          <LogsTab
            key={container.id}
            connectionId={connectionId}
            cid={container.id}
            active
          />
        </div>
      ) : null}
    </div>
  );
}
