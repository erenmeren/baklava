"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Pause, Play, RefreshCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── RefreshButton ───────────────────────────────────────────────────────
//
// Companion to AutoRefresh: a plain manual-refresh button for pages that
// don't poll. Centralises the icon + spin-while-loading treatment so every
// toolbar reads the same and tweaks happen in one place.

interface RefreshButtonProps {
  onClick: () => void | Promise<void>;
  loading?: boolean;
  /** Text label shown next to the icon. Defaults to "Refresh". */
  label?: string;
  /** Hide the label (icon-only). Useful in tight headers. */
  iconOnly?: boolean;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "default";
  className?: string;
}

export function RefreshButton({
  onClick,
  loading,
  label = "Refresh",
  iconOnly,
  size = "sm",
  variant = "outline",
  className,
}: RefreshButtonProps) {
  return (
    <Button
      size={iconOnly ? "icon-sm" : size}
      variant={variant}
      onClick={() => void onClick()}
      disabled={loading}
      title={iconOnly ? label : undefined}
      aria-label={iconOnly ? label : undefined}
      className={className}
    >
      <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
      {iconOnly ? null : label}
    </Button>
  );
}

export interface AutoRefreshInterval {
  /** Short label shown inside the pill, e.g. "5s", "1m". */
  label: string;
  ms: number;
}

/** Default cadence menu — shared across every overview / list page. */
export const DEFAULT_REFRESH_INTERVALS: AutoRefreshInterval[] = [
  { label: "5s", ms: 5_000 },
  { label: "15s", ms: 15_000 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
];

interface Props {
  /**
   * Polling interval in ms (fixed-interval mode). When `intervals` is also
   * passed, this becomes the *initial* pick — the user can then change it
   * via the inline dropdown.
   */
  intervalMs: number;
  /**
   * Optional list of selectable intervals. When supplied, the pill renders
   * an inline dropdown showing the current interval; picking a new one
   * restarts the timer immediately.
   */
  intervals?: AutoRefreshInterval[];
  onTick: () => void | Promise<void>;
  loading?: boolean;
  /** Default true — set false to start paused. */
  defaultPlaying?: boolean;
  /** Compact label shown when `intervals` is omitted. Defaults to "Live". */
  label?: string;
}

/**
 * Pause-able auto-refresh pill with a circular countdown that drains as
 * the next tick approaches. Optionally embeds an interval picker (5s /
 * 15s / 1m / …) inside the same pill — pass `intervals` to enable it.
 *
 * The countdown ring is a single SVG circle whose stroke-dashoffset
 * transitions over the current interval. When playing, the ring drains;
 * on tick (or when the user picks a new interval), it snaps back to full
 * and drains again.
 */
export function AutoRefresh({
  intervalMs,
  intervals,
  onTick,
  loading,
  defaultPlaying = true,
  label = "Live",
}: Props) {
  const [playing, setPlaying] = useState(defaultPlaying);
  const [currentMs, setCurrentMs] = useState(intervalMs);
  const [tickKey, setTickKey] = useState(0); // resets the ring animation
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback(async () => {
    setTickKey((k) => k + 1);
    await onTick();
  }, [onTick]);

  // Schedule loop — re-runs whenever play state or interval changes so a
  // mid-flight interval change immediately reschedules the next tick.
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }
    const loop = async () => {
      await fire();
      if (!playing) return;
      timerRef.current = setTimeout(loop, currentMs);
    };
    // First tick after currentMs, not immediately — the caller is
    // expected to do an initial load on mount.
    timerRef.current = setTimeout(loop, currentMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [playing, currentMs, fire]);

  const pickInterval = (ms: number) => {
    setCurrentMs(ms);
    // Bump tickKey so the ring re-mounts at the new duration even if the
    // user picks the same interval (no-op visually, but keeps animation
    // logic identical to a fresh tick).
    setTickKey((k) => k + 1);
  };

  const currentLabel =
    intervals?.find((i) => i.ms === currentMs)?.label ??
    `${Math.round(currentMs / 1000)}s`;

  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/60 px-1 py-0.5">
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        aria-pressed={playing}
        aria-label={playing ? "Pause auto-refresh" : "Resume auto-refresh"}
        className={cn(
          "relative inline-flex size-6 items-center justify-center rounded-full transition-colors",
          playing
            ? "text-brand hover:bg-brand/10"
            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
        )}
      >
        {/* Countdown ring (only when playing). Re-mounts on every tick
            and on every interval change so it always drains cleanly. */}
        {playing ? (
          <svg
            key={tickKey}
            className="absolute inset-0 size-full -rotate-90"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth="1.5"
            />
            <circle
              cx="12"
              cy="12"
              r="10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="62.8"
              style={{
                strokeDashoffset: 62.8,
                transition: `stroke-dashoffset ${currentMs}ms linear`,
              }}
              ref={(el) => {
                if (!el) return;
                // Kick the transition next frame so the browser actually
                // animates from 0 → 62.8 (full → empty visually).
                requestAnimationFrame(() => {
                  el.style.strokeDashoffset = "0";
                });
              }}
            />
          </svg>
        ) : null}
        {playing ? (
          <Pause className="relative z-10 size-2.5" />
        ) : (
          <Play className="relative z-10 size-2.5 translate-x-[0.5px]" />
        )}
      </button>

      {intervals && intervals.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5",
              "text-[10px] font-mono uppercase tracking-[0.18em]",
              "transition-colors outline-none",
              playing
                ? "text-foreground/80 hover:bg-foreground/5"
                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            )}
            aria-label="Change auto-refresh interval"
          >
            <span className="tabular-nums">{currentLabel}</span>
            <ChevronDown className="size-2.5 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[100px]">
            <DropdownMenuRadioGroup
              value={String(currentMs)}
              onValueChange={(v) => pickInterval(Number(v))}
            >
              {intervals.map((i) => (
                <DropdownMenuRadioItem
                  key={i.ms}
                  value={String(i.ms)}
                  className="font-mono text-xs"
                >
                  {i.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span
          className={cn(
            "px-1 text-[10px] font-mono uppercase tracking-[0.18em]",
            playing ? "text-foreground/80" : "text-muted-foreground",
          )}
        >
          {playing ? label : "Paused"}
        </span>
      )}

      <button
        type="button"
        onClick={() => void fire()}
        aria-label="Refresh now"
        title="Refresh now"
        disabled={loading}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-full",
          "text-muted-foreground hover:text-foreground hover:bg-foreground/10",
          "transition-colors disabled:opacity-50",
        )}
      >
        <RefreshCcw className={cn("size-3", loading && "animate-spin")} />
      </button>
    </div>
  );
}
