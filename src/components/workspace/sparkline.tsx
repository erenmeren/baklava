"use client";

import { cn } from "@/lib/utils";

interface Props {
  values: number[];
  width?: number;
  height?: number;
  /** "lag" gives a divergent palette (green when shrinking, red when growing). */
  tone?: "lag" | "neutral";
  className?: string;
  ariaLabel?: string;
}

/**
 * Compact sparkline used in dense tables (Kafka groups, topic throughput).
 * Renders as an SVG polyline with an area fill underneath. Auto-scales to
 * the local min/max so even small deltas are legible.
 *
 * `tone="lag"`: stroke color is computed from the *trend* of the last few
 * samples — green when lag is shrinking, red when growing, amber when flat.
 */
export function Sparkline({
  values,
  width = 96,
  height = 24,
  tone = "neutral",
  className,
  ariaLabel,
}: Props) {
  if (values.length < 2) {
    return (
      <div
        className={cn(
          "inline-flex items-center justify-center text-[10px] font-mono text-muted-foreground/40 tabular-nums",
          className,
        )}
        style={{ width, height }}
        aria-label={ariaLabel ?? "no history"}
      >
        ·
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const step = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y] as const;
  });
  const path = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPath = `M${points[0][0]},${height} L${path
    .split(" ")
    .join(" ")} L${points[points.length - 1][0]},${height} Z`;

  // Trend: average of last 4 samples vs prior 4. Drives color in lag mode.
  let stroke = "currentColor";
  let fill = "currentColor";
  if (tone === "lag") {
    const n = Math.min(4, Math.floor(values.length / 2));
    const recent = values.slice(-n).reduce((s, v) => s + v, 0) / n;
    const prior = values.slice(-n * 2, -n).reduce((s, v) => s + v, 0) / n;
    const delta = recent - prior;
    if (Math.abs(delta) < Math.max(1, prior * 0.02)) {
      stroke = "rgb(245 158 11)"; // amber-500 — flat
      fill = "rgb(245 158 11)";
    } else if (delta < 0) {
      stroke = "rgb(16 185 129)"; // emerald-500 — shrinking
      fill = "rgb(16 185 129)";
    } else {
      stroke = "rgb(239 68 68)"; // red-500 — growing
      fill = "rgb(239 68 68)";
    }
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={ariaLabel ?? `sparkline of ${values.length} samples`}
      className={cn("overflow-visible", className)}
    >
      <path d={areaPath} fill={fill} fillOpacity={0.12} />
      <polyline
        points={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Dot on the latest sample */}
      <circle
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r={1.6}
        fill={stroke}
      />
    </svg>
  );
}
