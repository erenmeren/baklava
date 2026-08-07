import { cn } from "@/lib/utils";
import type { PodPhase } from "@/lib/kubernetes/row-types";

/**
 * k9s-default-skin-inspired status palette:
 *   Running        → emerald
 *   Pending        → amber
 *   Succeeded/Done → cyan (cool)
 *   Failed/Error   → red
 *   CrashLoopBack  → red
 *   Terminating    → orange
 *   ImagePullBack  → red (slightly muted to distinguish)
 *   Init/Creating  → blue
 *   Unknown        → zinc
 *
 * The dot keeps the row scannable from a distance; the label keeps the
 * detail. Pulse the dot only for transient negative states so a healthy
 * page doesn't look like a disco.
 */

const STATUS_STYLE: Record<
  PodPhase,
  { dot: string; text: string; pulse?: boolean }
> = {
  Running: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  Succeeded: { dot: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400" },
  Completed: { dot: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-400" },
  Pending: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", pulse: true },
  ContainerCreating: { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400", pulse: true },
  Init: { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400", pulse: true },
  Terminating: { dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-400", pulse: true },
  CrashLoopBackOff: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", pulse: true },
  ImagePullBackOff: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", pulse: true },
  Error: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400", pulse: true },
  Failed: { dot: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  Unknown: { dot: "bg-zinc-500", text: "text-muted-foreground" },
};

export function StatusPill({ status }: { status: PodPhase | string }) {
  const style = STATUS_STYLE[status as PodPhase] ?? STATUS_STYLE.Unknown;
  return (
    <span className={cn("inline-flex items-center gap-1.5", style.text)}>
      <span
        className={cn(
          "size-1.5 rounded-full shrink-0",
          style.dot,
          style.pulse ? "status-pulse" : "",
        )}
      />
      <span>{status}</span>
    </span>
  );
}
