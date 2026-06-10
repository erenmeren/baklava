"use client";

/** Dependency-free inline SVG sparkline from a numeric history. */
export function Sparkline({
  data,
  className,
  muted = false,
}: {
  data: number[];
  className?: string;
  muted?: boolean;
}) {
  const w = 96;
  const h = 24;
  if (data.length < 2) {
    return <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden />;
  }
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / span) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={muted ? 0.35 : 1}
      />
    </svg>
  );
}
