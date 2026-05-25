"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared dialog-polish primitives. Each create / edit dialog gets the same
 * accent stripe, section label treatment, and field-row chrome so the
 * workspace's modal surface reads as one coherent visual language.
 *
 * Conventions:
 * - Tone matches the tech accent (rose=SQL Server, indigo=Postgres,
 *   sky=Docker, amber=Kafka). Pass the same tone to every block inside
 *   a single dialog.
 * - Use DialogBrandStripe immediately inside <DialogContent> so it sits
 *   above the header; the stripe is absolutely positioned and ignores
 *   the dialog's flex/grid flow.
 */

export type DialogTone = "rose" | "indigo" | "sky" | "amber" | "emerald";

const TONE_VIA: Record<DialogTone, string> = {
  rose: "via-rose-500/70",
  indigo: "via-indigo-500/70",
  sky: "via-sky-500/70",
  amber: "via-amber-500/70",
  emerald: "via-emerald-500/70",
};

const TONE_DOT: Record<DialogTone, string> = {
  rose: "bg-rose-500",
  indigo: "bg-indigo-500",
  sky: "bg-sky-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
};

const TONE_RING_GLOW: Record<DialogTone, string> = {
  rose: "shadow-[0_0_24px_-12px_rgba(244,63,94,0.6)]",
  indigo: "shadow-[0_0_24px_-12px_rgba(99,102,241,0.6)]",
  sky: "shadow-[0_0_24px_-12px_rgba(14,165,233,0.6)]",
  amber: "shadow-[0_0_24px_-12px_rgba(245,158,11,0.6)]",
  emerald: "shadow-[0_0_24px_-12px_rgba(16,185,129,0.6)]",
};

/**
 * One-pixel gradient stripe across the top of the dialog content,
 * tinted by the tech accent. Tiny detail that ties the modal to its
 * workspace without screaming.
 */
export function DialogBrandStripe({ tone }: { tone: DialogTone }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
        TONE_VIA[tone],
      )}
    />
  );
}

/**
 * Uppercase tracked-out section header for grouping form fields inside
 * a dialog. The little colored dot picks up the tech accent so several
 * sections in the same dialog read as a set.
 */
export function DialogSection({
  label,
  hint,
  tone = "rose",
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  tone?: DialogTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2.5", className)}>
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground inline-flex items-center gap-1.5">
          <span
            className={cn("size-1 rounded-full", TONE_DOT[tone])}
            aria-hidden
          />
          {label}
        </h3>
        {hint ? (
          <span className="truncate text-[10px] font-mono text-muted-foreground/70">
            {hint}
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/**
 * Hairline divider between dialog sections — gentler than a full
 * border, more deliberate than empty whitespace.
 */
export function DialogDivider() {
  return <div aria-hidden className="h-px bg-border/50" />;
}

/**
 * Primary CTA shadow glow utility — drop into a Button's className for
 * the soft brand-tinted halo on the dialog's main action. Pair with
 * the normal Button variant + size; this just adds the glow.
 */
export function ctaGlow(tone: DialogTone) {
  return TONE_RING_GLOW[tone];
}

/**
 * Compact pill button for tri-state mode toggles (e.g. null / default /
 * value on a column editor). Active state is the brand tone; inactive
 * is muted with a hover lift.
 */
export function ModePill({
  active,
  onClick,
  disabled,
  tone = "rose",
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone?: DialogTone;
  children: ReactNode;
}) {
  const activeRing = {
    rose: "ring-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
    indigo:
      "ring-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    sky: "ring-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
    amber:
      "ring-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    emerald:
      "ring-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center rounded-full px-2 py-px text-[10px] font-mono uppercase tracking-[0.12em] transition-colors",
        active
          ? `ring-1 ring-inset ${activeRing}`
          : "text-muted-foreground hover:text-foreground hover:bg-foreground/5 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
