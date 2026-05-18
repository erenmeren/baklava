"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  intervalMs: number;
  onTick: () => void | Promise<void>;
  loading?: boolean;
  /** Default true — set false to start paused. */
  defaultPlaying?: boolean;
  /** Compact label. Defaults to "Live". */
  label?: string;
}

/**
 * Pause-able auto-refresh pill with a circular countdown that drains as
 * the next tick approaches. Designed for workspace headers (Kafka groups,
 * topic messages, container lists, etc.) — anywhere the page should feel
 * live rather than snapshot-y.
 *
 * The countdown ring is a single SVG circle whose stroke-dashoffset
 * transitions over `intervalMs`. When playing, the ring drains; on tick,
 * it snaps back to full and drains again.
 */
export function AutoRefresh({
  intervalMs,
  onTick,
  loading,
  defaultPlaying = true,
  label = "Live",
}: Props) {
  const [playing, setPlaying] = useState(defaultPlaying);
  const [tickKey, setTickKey] = useState(0); // resets the ring animation
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback(async () => {
    setTickKey((k) => k + 1);
    await onTick();
  }, [onTick]);

  // Schedule loop.
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      return;
    }
    const loop = async () => {
      await fire();
      if (!playing) return;
      timerRef.current = setTimeout(loop, intervalMs);
    };
    // First tick after intervalMs, not immediately — the caller is
    // expected to do an initial load on mount.
    timerRef.current = setTimeout(loop, intervalMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [playing, intervalMs, fire]);

  // The ring: when `playing`, animate from full → empty over intervalMs;
  // tickKey re-mounts the SVG to restart the animation cleanly.
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-1 py-0.5">
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
        {/* Countdown ring (only when playing). The animation key
            resets every tick so it always drains from full again. */}
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
                transition: `stroke-dashoffset ${intervalMs}ms linear`,
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

      <span
        className={cn(
          "text-[10px] font-mono uppercase tracking-[0.18em]",
          playing ? "text-foreground/80" : "text-muted-foreground",
        )}
      >
        {playing ? label : "Paused"}
      </span>

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
