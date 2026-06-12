import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/loadtest/store";

const STYLES: Record<RunStatus, string> = {
  running: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  passed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  error: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export function StatusPill({ status }: { status: RunStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        STYLES[status],
      )}
    >
      {status === "running" ? <span className="size-1.5 rounded-full bg-amber-500 status-pulse" /> : null}
      {status}
    </span>
  );
}
