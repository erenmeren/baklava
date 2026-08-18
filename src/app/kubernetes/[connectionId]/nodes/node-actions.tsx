"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { NodeRow } from "@/lib/kubernetes/row-types";

interface Props {
  connectionId: string;
  row: NodeRow;
  close: () => void;
  refresh: () => void;
}

interface DrainOutcome {
  evicted: number;
  failures: Array<{ pod: string; error: string }>;
}

async function postAction(
  connectionId: string,
  node: string,
  action: "cordon" | "uncordon" | "drain",
): Promise<DrainOutcome> {
  const res = await fetch(
    `/api/kubernetes/${connectionId}/nodes/${encodeURIComponent(node)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    evicted?: number;
    failures?: Array<{ pod: string; error: string }>;
  };
  if (!res.ok || data.error) {
    throw new Error(data.error || `request failed (${res.status})`);
  }
  return { evicted: data.evicted ?? 0, failures: data.failures ?? [] };
}

function Shell({
  title,
  tone,
  children,
  error,
  onClose,
  action,
}: {
  title: string;
  tone: "cyan" | "red";
  children: React.ReactNode;
  error: string | null;
  onClose: () => void;
  action: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />
      <div
        className={cn(
          "relative z-10 w-full max-w-md rounded-lg border bg-popover shadow-2xl overflow-hidden",
          tone === "red" ? "border-red-500/30" : "border-cyan-500/30",
        )}
      >
        <div
          className={cn(
            "px-5 py-3 border-b border-border/60 font-mono flex items-center gap-2",
            tone === "red" ? "bg-red-500/5" : "bg-cyan-500/5",
          )}
        >
          <span
            className={cn(
              "uppercase tracking-[0.22em] text-[9px] px-1.5 py-0.5 rounded",
              tone === "red"
                ? "bg-red-500/15 text-red-700 dark:text-red-300"
                : "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
            )}
          >
            node
          </span>
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="px-5 py-4 text-sm text-foreground/85 leading-relaxed space-y-3">
          {children}
          {error ? (
            <span role="alert" className="block font-mono text-xs text-destructive">
              {error}
            </span>
          ) : null}
        </div>
        <div className="px-5 py-3 border-t border-border/60 bg-muted/30 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-border/60 px-3 py-1.5 text-xs font-mono hover:bg-foreground/5"
          >
            close
          </button>
          {action}
        </div>
      </div>
    </div>
  );
}

/** Cordon or uncordon, depending on which state the node is already in. */
export function CordonDialog({ connectionId, row, close, refresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = row.schedulable ? "cordon" : "uncordon";

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await postAction(connectionId, row.name, next);
      refresh();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      tone="cyan"
      title={next === "cordon" ? "Cordon node?" : "Uncordon node?"}
      error={error}
      onClose={close}
      action={
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded bg-cyan-600 hover:bg-cyan-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-mono"
        >
          {busy ? `${next}ing…` : next}
        </button>
      }
    >
      <span className="block">
        <span className="font-mono text-foreground">{row.name}</span>{" "}
        {next === "cordon"
          ? "stops accepting new pods. Running pods stay where they are."
          : "becomes schedulable again."}
      </span>
    </Shell>
  );
}

export function DrainDialog({ connectionId, row, close, refresh }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DrainOutcome | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postAction(connectionId, row.name, "drain");
      setOutcome(result);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      tone="red"
      title="Drain node?"
      error={error}
      onClose={close}
      action={
        outcome ? null : (
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white px-3 py-1.5 text-xs font-mono"
          >
            {busy ? "draining…" : `Drain ${row.name}`}
          </button>
        )
      }
    >
      {outcome ? (
        <div className="space-y-2">
          <span className="block">
            Evicted{" "}
            <span className="font-mono text-foreground">{outcome.evicted}</span> pod
            {outcome.evicted === 1 ? "" : "s"} from{" "}
            <span className="font-mono text-foreground">{row.name}</span>.
          </span>
          {outcome.failures.length > 0 ? (
            <div className="space-y-1">
              <span className="block text-xs text-amber-700 dark:text-amber-300">
                {outcome.failures.length} pod
                {outcome.failures.length === 1 ? "" : "s"} refused eviction — usually a
                PodDisruptionBudget:
              </span>
              <ul className="font-mono text-[11px] text-muted-foreground space-y-0.5 max-h-40 overflow-auto">
                {outcome.failures.map((f) => (
                  <li key={f.pod}>
                    {f.pod}: {f.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <span className="block">
          Cordons <span className="font-mono text-foreground">{row.name}</span> and evicts
          its pods. DaemonSet and static pods stay — evicting them would achieve nothing.
          Eviction respects PodDisruptionBudgets, so some pods may refuse.
        </span>
      )}
    </Shell>
  );
}
