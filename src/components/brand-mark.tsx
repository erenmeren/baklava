interface BrandMarkProps {
  className?: string;
  size?: number;
  /** Animate the cursor block (terminal blink). Defaults to true. */
  blink?: boolean;
}

// Baklava brand mark (B2.1 "Classic"): a terminal prompt — a chevron `>` and a
// blinking block cursor. Drawn in `currentColor` so it inherits the surrounding
// text color (foreground in the header, brand-amber on hover) and adapts to
// light/dark automatically. The blink respects prefers-reduced-motion.
export function BrandMark({ className, size = 22, blink = true }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden
      className={className}
    >
      <polyline
        points="26,30 48,50 26,70"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="58"
        y="40"
        width="20"
        height="20"
        fill="currentColor"
        className={blink ? "bk-blink" : undefined}
      />
    </svg>
  );
}
